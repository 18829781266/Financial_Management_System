package com.langchao.archive.service;
import com.langchao.archive.mapper.SysLogMapper;
import com.langchao.archive.model.SysLog;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
@Service
public class AuditService {
    private final SysLogMapper mapper;
    public AuditService(SysLogMapper mapper) { this.mapper=mapper; }
    public void log(String action,String type,Object id,String detail,String actor) {
        SysLog row=new SysLog(); row.setAction(action);row.setTargetType(type);row.setTargetId(String.valueOf(id));row.setDetail(detail);row.setOperator(actor);row.setCreatedAt(LocalDateTime.now());mapper.insert(row);
    }
}
