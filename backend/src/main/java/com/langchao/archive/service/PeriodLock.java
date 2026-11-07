package com.langchao.archive.service;

import com.langchao.archive.api.ApiException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/** Redis租约采用随机token + Lua校验续租/释放；数据库行锁仍是最终防重保障。 */
@Component
public class PeriodLock {
    private static final long LEASE_MS=30000;
    private final StringRedisTemplate redis;
    public PeriodLock(StringRedisTemplate redis) { this.redis=redis; }
    public <T> T execute(String period, Supplier<T> work) {
        String key="archive:lock:period:"+period, token=UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key,token,Duration.ofMillis(LEASE_MS)))) {
            throw new ApiException(409,"本期间正在执行匹配或归档，请稍后重试");
        }
        AtomicBoolean lost=new AtomicBoolean(false);
        ScheduledExecutorService watchdog=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"match-lease");t.setDaemon(true);return t;});
        ScheduledFuture<?> renewal=watchdog.scheduleAtFixedRate(()->{
            try {
                Long result=redis.execute(new DefaultRedisScript<>("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",Long.class),List.of(key),token,String.valueOf(LEASE_MS));
                if(result==null||result==0) lost.set(true);
            } catch(RuntimeException e) { lost.set(true); }
        },10,10,TimeUnit.SECONDS);
        try {
            T result=work.get();
            // 即使租约丢失，业务也持有数据库行锁，不能出现双重分配。返回状态提示调用者刷新。
            if(lost.get()) throw new ApiException(409,"处理期间Redis租约中断，数据库已保持一致，请刷新结果");
            return result;
        } finally {
            renewal.cancel(false); watchdog.shutdownNow();
            try { redis.execute(new DefaultRedisScript<>("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",Long.class),List.of(key),token); }
            catch(RuntimeException ignored) { /* 释放失败时由TTL自动回收，绝不删除其他持有者的锁。 */ }
        }
    }
}
