CREATE TABLE security_request_audit (
    hour timestamptz NOT NULL,
    actor text NOT NULL,
    source text NOT NULL,
    method text NOT NULL,
    endpoint text NOT NULL,
    status integer NOT NULL,
    requests bigint NOT NULL DEFAULT 1,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (hour, actor, source, method, endpoint, status)
);
CREATE INDEX security_request_audit_actor ON security_request_audit (actor);

-- Serialize the bounded new-key check across replicas. Repeated attempts aggregate.
CREATE FUNCTION record_security_request(a text, s text, m text, e text, code integer, subject text)
RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE h timestamptz := date_trunc('hour', now());
BEGIN
    IF subject <> '' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(subject, 0));
        IF EXISTS (SELECT 1 FROM user_deletion_requests WHERE logto_sub=subject AND status='purged') THEN
            RETURN true;
        END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(39320261026);

    UPDATE security_request_audit SET requests=requests+1, last_seen=now()
      WHERE hour=h AND actor=a AND source=s AND method=m AND endpoint=e AND status=code;
    IF FOUND THEN RETURN true; END IF;
    -- Keep anonymous floods from consuming the authenticated-actor budget.
    IF (SELECT count(*) FROM security_request_audit
        WHERE hour >= date_trunc('day', now()) AND (actor='')=(a='')) >= 10000 THEN
        RETURN false;
    END IF;
    INSERT INTO security_request_audit(hour,actor,source,method,endpoint,status)
      VALUES(h,a,s,m,e,code);
    RETURN true;
END
$fn$;
