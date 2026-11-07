package com.langchao.archive.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.langchao.archive.api.*;
import com.langchao.archive.engine.MatchingEngine;
import com.langchao.archive.mapper.*;
import com.langchao.archive.model.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class MatchService {
    private final VoucherMapper vouchers;
    private final SourceDocumentMapper documents;
    private final MatchRelationMapper relations;
    private final MatchRuleMapper rules;
    private final VoucherEntryMapper entries;
    private final TransactionTemplate tx;
    private final PeriodLock lock;
    private final StringRedisTemplate redis;
    private final ObjectMapper json;
    private final MatchingEngine engine;
    private final AuditService audit;
    public MatchService(VoucherMapper vouchers,SourceDocumentMapper documents,MatchRelationMapper relations,MatchRuleMapper rules,
        VoucherEntryMapper entries,TransactionTemplate tx,PeriodLock lock,StringRedisTemplate redis,ObjectMapper json,AuditService audit) {
        this.vouchers=vouchers;this.documents=documents;this.relations=relations;this.rules=rules;this.entries=entries;this.tx=tx;this.lock=lock;this.redis=redis;this.json=json;this.audit=audit;this.engine=new MatchingEngine();
    }
    public Map<String,Object> auto(String period,String actor) {
        return lock.execute(period,()->{
            List<MatchingEngine.Proposal> committed=tx.execute(status->{
                // 始终从数据库取得权威状态并按ID加行锁。即使Redis租约中断，另一事务也不能重复认领。
                List<Voucher> vs=vouchers.selectList(new QueryWrapper<Voucher>().eq("period",period).eq("status","PENDING").orderByAsc("id").last("FOR UPDATE"));
                List<SourceDocument> ds=documents.selectList(new QueryWrapper<SourceDocument>().eq("period",period).eq("status","PENDING").orderByAsc("id").last("FOR UPDATE"));
                rebuildPool(period,vs,ds);
                List<MatchingEngine.Proposal> proposals=engine.match(vs,ds,loadRules());
                Map<Long,Voucher> vmap=new HashMap<>();vs.forEach(v->vmap.put(v.getId(),v));Map<Long,SourceDocument> dmap=new HashMap<>();ds.forEach(d->dmap.put(d.getId(),d));
                for(var proposal:proposals) bind(proposal.voucherIds().stream().map(vmap::get).toList(),proposal.documentIds().stream().map(dmap::get).toList(),"AUTO",proposal.ruleId(),proposal.confidenceScore(),proposal.explanation(),"规则自动匹配",actor);
                audit.log("AUTO_MATCH","PERIOD",period,"匹配组数="+proposals.size(),actor);return proposals;
            });
            // 只有DB提交之后才移除待匹配缓存；清缓存失败不回滚已提交关联，下次会由数据库重建。
            for(var p:committed) {cacheRemove("voucher",period,p.voucherIds());cacheRemove("document",period,p.documentIds());}
            return Map.of("matchedGroups",committed.size(),"matchedVouchers",committed.stream().mapToLong(p->p.voucherIds().size()).sum(),"matchedDocuments",committed.stream().mapToLong(p->p.documentIds().size()).sum(),"proposals",committed);
        });
    }
    public Map<String,Object> manual(ApiModels.ManualRequest request,String actor) {
        Voucher existing=requiredVoucher(request.voucherId());
        return lock.execute(existing.getPeriod(),()->{
            String group=tx.execute(status->{
                Voucher v=vouchers.selectOne(new QueryWrapper<Voucher>().eq("id",request.voucherId()).last("FOR UPDATE"));
                if(!"PENDING".equals(v.getStatus())&&!"MISSING".equals(v.getStatus())) throw new ApiException(409,"凭证已匹配或已锁定");
                List<Long> ids=request.documentIds().stream().distinct().sorted().toList();if(ids.size()!=request.documentIds().size())throw new ApiException(400,"手工匹配单据ID重复");
                List<SourceDocument> ds=documents.selectList(new QueryWrapper<SourceDocument>().in("id",ids).orderByAsc("id").last("FOR UPDATE"));
                if(ds.size()!=ids.size()) throw new ApiException(404,"部分单据不存在");
                for(var d:ds) if(!"PENDING".equals(d.getStatus())||!v.getPeriod().equals(d.getPeriod())) throw new ApiException(409,"单据已占用或不属于相同期间");
                BigDecimal total=ds.stream().map(SourceDocument::getAmount).reduce(BigDecimal.ZERO,BigDecimal::add);
                if(v.getAmount().subtract(total).abs().compareTo(new BigDecimal("0.05"))>0) throw new ApiException(422,"凭证与所选单据汇总金额不一致，尾差上限0.05元");
                String id=bind(List.of(v),ds,"MANUAL",null,BigDecimal.ONE,Map.of("reviewedBy",actor),request.reason(),actor);
                audit.log("MANUAL_MATCH","RELATION",id,request.reason(),actor);return id;
            });
            cacheRemove("voucher",existing.getPeriod(),List.of(existing.getId()));cacheRemove("document",existing.getPeriod(),request.documentIds());return Map.of("relationId",group);
        });
    }
    private String bind(List<Voucher> vs,List<SourceDocument> ds,String type,String rule,BigDecimal confidence,Map<String,Object> why,String reason,String actor) {
        if(vs.size()>1&&ds.size()>1)throw new ApiException(422,"暂不支持多对多分配");
        String group=UUID.randomUUID().toString();
        for(Voucher v:vs)for(SourceDocument d:ds) {
            // 一凭证多单据时按每张单据金额分配；多凭证一单据时按各凭证金额分配。
            // 整组必须汇总相等（允许经规则配置的尾差），并一次性认领所有资源，不能再次使用。
            MatchRelation r=new MatchRelation();r.setRelationId(group);r.setVoucherId(v.getId());r.setDocId(d.getId());r.setAllocatedAmount(vs.size()>1?v.getAmount():d.getAmount());
            r.setMatchType(type);r.setRuleId(rule);r.setConfidenceScore(confidence);r.setCreator(actor);r.setReason(reason);r.setExplanation(why);r.setCreatedAt(LocalDateTime.now());relations.insert(r);
        }
        for(Voucher v:vs) {v.setStatus("MATCHED");v.setMissingReason(null);vouchers.updateById(v);}
        for(SourceDocument d:ds) {d.setStatus("MATCHED");documents.updateById(d);}
        return group;
    }
    public Map<String,Object> exceptions(String period,long page,long size) {
        var v=vouchers.selectPage(new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(page,size),new QueryWrapper<Voucher>().eq(period!=null&&!period.isBlank(),"period",period).in("status",List.of("PENDING","MISSING")).orderByAsc("voucher_sequence"));
        var d=documents.selectPage(new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(page,size),new QueryWrapper<SourceDocument>().eq(period!=null&&!period.isBlank(),"period",period).eq("status","PENDING").orderByAsc("id"));
        return Map.of("vouchers",v,"documents",d);
    }
    public List<Map<String,Object>> recommendations(long voucherId) {
        Voucher v=requiredVoucher(voucherId);
        return documents.selectList(new QueryWrapper<SourceDocument>().eq("period",v.getPeriod()).eq("status","PENDING").le("amount",v.getAmount().add(new BigDecimal("0.05"))).orderByDesc("amount").last("LIMIT 200"))
            .stream().map(d->{long days=Math.abs(ChronoUnit.DAYS.between(v.getVoucherDate(),d.getDocumentDate()));double amountGap=v.getAmount().subtract(d.getAmount()).abs().divide(v.getAmount(),8,java.math.RoundingMode.HALF_UP).doubleValue();double score=Math.max(0,1-amountGap)*0.7+Math.max(0,1-days/30.0)*0.3;return Map.<String,Object>of("document",d,"recommendationScore",BigDecimal.valueOf(score).setScale(4,java.math.RoundingMode.HALF_UP),"dateGapDays",days);})
            .sorted(Comparator.comparing(m->(BigDecimal)m.get("recommendationScore"),Comparator.reverseOrder())).limit(20).toList();
    }
    public void missing(long voucherId,String reason,String actor) {
        Voucher current=requiredVoucher(voucherId);
        lock.execute(current.getPeriod(),()->tx.execute(status->{
            Voucher v=vouchers.selectOne(new QueryWrapper<Voucher>().eq("id",voucherId).last("FOR UPDATE"));
            if(!Set.of("PENDING","MISSING").contains(v.getStatus()))throw new ApiException(409,"已匹配或锁定的凭证不能标记缺失");
            v.setStatus("MISSING");v.setMissingReason(reason);vouchers.updateById(v);audit.log("MARK_MISSING","VOUCHER",voucherId,reason,actor);return null;
        }));
        cacheRemove("voucher",current.getPeriod(),List.of(voucherId));
    }
    public List<MatchRule> loadRules() {
        try {String cached=redis.opsForValue().get("archive:rules:v1");if(cached!=null)return json.readValue(cached,new TypeReference<List<MatchRule>>(){});}catch(Exception ignored){/* DB回源，Redis不作为规则唯一来源。 */}
        List<MatchRule> rows=rules.selectList(new QueryWrapper<MatchRule>().orderByAsc("priority"));
        try{redis.opsForValue().set("archive:rules:v1",json.writeValueAsString(rows),Duration.ofMinutes(5));}catch(Exception ignored){}
        return rows;
    }
    public MatchRule updateRule(String id,ApiModels.RuleUpdate request,String actor) {
        validateConditions(request.conditions());
        MatchRule result=tx.execute(status->{
            MatchRule rule=rules.selectOne(new QueryWrapper<MatchRule>().eq("rule_id",id).last("FOR UPDATE"));
            if(rule==null)throw new ApiException(404,"规则不存在");
            if(!Objects.equals(rule.getVersion(),request.version()))throw new ApiException(409,"规则已被其他用户修改");
            rule.setThreshold(request.threshold());rule.setConditions(request.conditions());rule.setEnabled(request.enabled());rule.setVersion(rule.getVersion()+1);rules.updateById(rule);audit.log("RULE_UPDATE","RULE",id,"规则版本="+rule.getVersion(),actor);return rule;
        });
        redis.delete("archive:rules:v1");return result;
    }
    private void validateConditions(Map<String,Object> conditions) {
        for(String key:conditions.keySet())if(!Set.of("absTolerance","relativeTolerance","nameThreshold","dateWindowDays","maxCandidates","maxNodes").contains(key))throw new ApiException(400,"未知规则条件："+key);
        for(var e:conditions.entrySet()) {
            BigDecimal value;
            try{value=new BigDecimal(String.valueOf(e.getValue()));}catch(Exception ex){throw new ApiException(400,"规则条件必须为数字");}
            if(value.signum()<0)throw new ApiException(400,"规则条件不能为负数");
            if(Set.of("dateWindowDays","maxCandidates","maxNodes").contains(e.getKey())) {
                try { value.intValueExact(); } catch(ArithmeticException ex) { throw new ApiException(400,"日期窗口和搜索预算必须为整数"); }
            }
            if("dateWindowDays".equals(e.getKey())&&value.compareTo(new BigDecimal("366"))>0)throw new ApiException(400,"日期窗口不能超过366天");
            if(Set.of("nameThreshold","relativeTolerance").contains(e.getKey())&&value.compareTo(BigDecimal.ONE)>0)throw new ApiException(400,"比例条件必须介于0与1");
            if("maxCandidates".equals(e.getKey())&&(value.compareTo(new BigDecimal("20"))>0||value.intValue()<2))throw new ApiException(400,"汇总候选数必须介于2与20");
            if("maxNodes".equals(e.getKey())&&(value.compareTo(new BigDecimal("100000"))>0||value.intValue()<1))throw new ApiException(400,"汇总搜索节点上限为100000");
        }
    }
    public Map<String,Object> chain(String relationId) {
        List<MatchRelation> initial=relations.selectList(new QueryWrapper<MatchRelation>().eq("relation_id",relationId));if(initial.isEmpty())throw new ApiException(404,"关联不存在");
        Set<Long> vids=new HashSet<>(),dids=new HashSet<>();Map<Long,MatchRelation> found=new LinkedHashMap<>();List<MatchRelation> frontier=initial;
        while(!frontier.isEmpty()) {
            boolean changed=false;for(var r:frontier){found.put(r.getId(),r);changed|=vids.add(r.getVoucherId());changed|=dids.add(r.getDocId());}
            if(!changed)break;
            if(found.size()>10000)throw new ApiException(422,"证据链过大，请按凭证缩小范围");
            frontier=relations.selectList(new QueryWrapper<MatchRelation>().and(w->w.in("voucher_id",vids).or().in("doc_id",dids)).orderByAsc("id"));
        }
        return Map.of("relationId",relationId,"relations",found.values(),"vouchers",vouchers.selectBatchIds(vids),"documents",documents.selectBatchIds(dids),"entries",entries.selectList(new QueryWrapper<VoucherEntry>().in("voucher_id",vids).orderByAsc("voucher_id","line_no")));
    }
    private Voucher requiredVoucher(long id) {Voucher v=vouchers.selectById(id);if(v==null)throw new ApiException(404,"凭证不存在");return v;}
    private void rebuildPool(String period,List<Voucher> vs,List<SourceDocument> ds) {
        try {redis.delete(List.of("archive:pending:voucher:"+period,"archive:pending:document:"+period));
            if(!vs.isEmpty())redis.opsForSet().add("archive:pending:voucher:"+period,vs.stream().map(v->String.valueOf(v.getId())).toArray(String[]::new));
            if(!ds.isEmpty())redis.opsForSet().add("archive:pending:document:"+period,ds.stream().map(d->String.valueOf(d.getId())).toArray(String[]::new));
        }catch(RuntimeException ignored){}
    }
    private void cacheRemove(String type,String period,List<Long> ids){try{if(!ids.isEmpty())redis.opsForSet().remove("archive:pending:"+type+":"+period,ids.stream().map(String::valueOf).toArray());}catch(RuntimeException ignored){}}
}
