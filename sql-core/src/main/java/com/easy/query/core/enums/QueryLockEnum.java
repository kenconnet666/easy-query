package com.easy.query.core.enums;

/**
 * Query lock mode.
 *
 * @author xuejiaming
 */
public enum QueryLockEnum {
    NONE,
    FOR_UPDATE,
    /** fork：拿不到锁立即报错（FOR UPDATE NOWAIT） */
    FOR_UPDATE_NOWAIT,
    /** fork：跳过已被别的事务锁住的行（FOR UPDATE SKIP LOCKED；HANA 为 IGNORE LOCKED） */
    FOR_UPDATE_SKIP_LOCKED
}
