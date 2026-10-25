import { getJourney } from './journeys.mjs';
import { migrateDatabase } from './database-migrations.mjs';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createArrivalEmailDraft } from './email-draft.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;
const codeLifetime = 10 * minute;
const maxScheduleAhead = 30 * day;
const personalDataRetention = 30 * day;

export class EmailFlowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EmailFlowError';
    this.status = status;
  }
}

function normalizedEmail(value) {
  if (typeof value !== 'string') throw new EmailFlowError('Enter one valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) {
    throw new EmailFlowError('Enter one valid email address.');
  }
  return email;
}

function codeDigest(challengeId, code) {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

function reviewDigest(email, scheduledAt, subject, body) {
  return createHash('sha256').update(JSON.stringify([email, scheduledAt, subject, body])).digest('hex');
}

function publicJob(row) {
  return {
    id: row.id, status: row.status, scheduledAt: new Date(row.scheduled_at).toISOString(),
    confirmedAt: new Date(row.confirmed_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    deliveryEvent: row.delivery_event || null,
    failureReason: row.failure_reason || null,
  };
}

export function createEmailScheduler({ dbPath = ':memory:', provider, clock = Date.now }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL;');
  try { migrateDatabase(db, 'email', { dbPath }); } catch (error) { db.close(); throw error; }

  const challengeById = db.prepare('SELECT * FROM email_verifications WHERE id = ?');
  const eventInsert = db.prepare('INSERT INTO email_events(job_id, event, at, detail) VALUES(?, ?, ?, ?)');
  const jobByVerification = db.prepare('SELECT * FROM email_jobs WHERE verification_id = ?');
  const jobById = db.prepare('SELECT * FROM email_jobs WHERE id = ?');
  const record = (id, event, detail = null) => eventInsert.run(id, event, clock(), detail);

  function checkedChallenge(sessionId, challengeId, requireVerified = false) {
    if (typeof challengeId !== 'string') throw new EmailFlowError('Verify your email address first.', 403);
    const challenge = challengeById.get(challengeId);
    if (!challenge || challenge.session_id !== sessionId) {
      throw new EmailFlowError('Verify your email address in this conversation first.', 403);
    }
    if (challenge.expires_at <= clock() && !challenge.verified_at) {
      throw new EmailFlowError('The verification code expired. Request a new one.', 410);
    }
    if (requireVerified && !challenge.verified_at) throw new EmailFlowError('Verify your email address first.', 403);
    return challenge;
  }

  function checkedSchedule(scheduledAt) {
    const time = typeof scheduledAt === 'string' ? Date.parse(scheduledAt) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString() !== scheduledAt
      || time < clock() + minute || time > clock() + maxScheduleAhead) {
      throw new EmailFlowError('Choose a send time at least one minute from now and within 30 days.');
    }
    return time;
  }

  async function requestVerification(sessionId, value) {
    if (!provider) throw new EmailFlowError('Email delivery is not configured yet.', 503);
    const email = normalizedEmail(value);
    const now = clock();
    const recentForEmail = db.prepare('SELECT COUNT(*) AS count FROM email_verifications WHERE email = ? AND created_at > ?').get(email, now - 60 * minute).count;
    const recentForSession = db.prepare('SELECT COUNT(*) AS count FROM email_verifications WHERE session_id = ? AND created_at > ?').get(sessionId, now - 60 * minute).count;
    if (recentForEmail >= 3 || recentForSession >= 5) throw new EmailFlowError('Too many verification requests. Please try later.', 429);
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare('INSERT INTO email_verifications(id, session_id, email, code_hash, created_at, expires_at, send_state) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(id, sessionId, email, codeDigest(id, code), now, now + codeLifetime, 'pending');
    try {
      const result = await provider.send({
        to: email, subject: 'Your Noor verification code',
        text: `Your Noor verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        idempotencyKey: `verify/${id}`,
      });
      db.prepare('UPDATE email_verifications SET send_state = ?, provider_id = ? WHERE id = ?')
        .run('accepted', result.id, id);
      return { challengeId: id, expiresAt: new Date(now + codeLifetime).toISOString(), delivery: 'accepted' };
    } catch (error) {
      if (error.outcome === 'rejected') {
        db.prepare('UPDATE email_verifications SET send_state = ? WHERE id = ?').run('rejected', id);
        throw new EmailFlowError('The verification email was rejected. Check the address and try again.', 502);
      }
      db.prepare('UPDATE email_verifications SET send_state = ? WHERE id = ?').run('unconfirmed', id);
      return { challengeId: id, expiresAt: new Date(now + codeLifetime).toISOString(), delivery: 'unconfirmed' };
    }
  }

  function verify(sessionId, challengeId, code) {
    const challenge = checkedChallenge(sessionId, challengeId);
    if (challenge.verified_at) return { verified: true, email: challenge.email };
    if (challenge.attempts >= 5) throw new EmailFlowError('Too many attempts. Request a new code.', 429);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new EmailFlowError('Enter the six-digit code.');
    const actual = Buffer.from(codeDigest(challengeId, code), 'hex');
    const expected = Buffer.from(challenge.code_hash, 'hex');
    if (!timingSafeEqual(actual, expected)) {
      db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?').run(challengeId);
      throw new EmailFlowError('That code did not match.', 400);
    }
    db.prepare('UPDATE email_verifications SET verified_at = ? WHERE id = ?').run(clock(), challengeId);
    return { verified: true, email: challenge.email };
  }

  function review(sessionId, challengeId, scheduledAt, journeyId) {
    const challenge = checkedChallenge(sessionId, challengeId, true);
    const time = checkedSchedule(scheduledAt);
    const draft = createArrivalEmailDraft(getJourney(journeyId));
    return {
      to: challenge.email, subject: draft.subject, body: draft.body,
      scheduledAt: new Date(time).toISOString(), attachments: [],
      reviewHash: reviewDigest(challenge.email, time, draft.subject, draft.body),
    };
  }

  function schedule(sessionId, challengeId, scheduledAt, reviewHash, journeyId) {
    if (!provider) throw new EmailFlowError('Email delivery is not configured yet.', 503);
    checkedChallenge(sessionId, challengeId, true);
    const prior = jobByVerification.get(challengeId);
    if (prior) {
      if (prior.review_hash !== reviewHash || new Date(prior.scheduled_at).toISOString() !== scheduledAt) {
        throw new EmailFlowError('This verification was already used for another email.', 409);
      }
      return publicJob(prior);
    }
    const preview = review(sessionId, challengeId, scheduledAt, journeyId);
    if (typeof reviewHash !== 'string' || reviewHash !== preview.reviewHash) {
      throw new EmailFlowError('The draft or send time changed. Review it again.', 409);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = jobByVerification.get(challengeId);
      if (existing) {
        if (existing.review_hash !== reviewHash) throw new EmailFlowError('This verification was already used for another email.', 409);
        db.exec('COMMIT');
        return publicJob(existing);
      }
      const id = randomUUID();
      const now = clock();
      db.prepare(`INSERT INTO email_jobs(id, verification_id, email, subject, body, review_hash,
        scheduled_at, status, confirmed_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`).run(
        id, challengeId, preview.to, preview.subject, preview.body,
        reviewHash, Date.parse(preview.scheduledAt), now,
      );
      record(id, 'passenger_confirmed');
      record(id, 'scheduled');
      db.exec('COMMIT');
      return publicJob(jobById.get(id));
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function list(sessionId, challengeId) {
    const challenge = checkedChallenge(sessionId, challengeId, true);
    return db.prepare('SELECT * FROM email_jobs WHERE email = ? ORDER BY confirmed_at DESC LIMIT 20')
      .all(challenge.email).map(publicJob);
  }

  function cancel(sessionId, challengeId, jobId) {
    const challenge = checkedChallenge(sessionId, challengeId, true);
    const job = typeof jobId === 'string' ? jobById.get(jobId) : null;
    if (!job || job.email !== challenge.email) throw new EmailFlowError('Email request not found.', 404);
    if (job.status === 'cancelled') return publicJob(job);
    if (job.status !== 'scheduled') throw new EmailFlowError('This email can no longer be cancelled.', 409);
    const changed = db.prepare("UPDATE email_jobs SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'scheduled'")
      .run(clock(), jobId).changes;
    if (!changed) throw new EmailFlowError('This email can no longer be cancelled.', 409);
    record(jobId, 'cancelled');
    return publicJob(jobById.get(jobId));
  }

  let running = false;
  async function runDue() {
    if (!provider || running) return;
    running = true;
    try {
      const now = clock();
      db.prepare("UPDATE email_jobs SET status = 'unknown', failure_reason = 'Provider outcome could not be confirmed.' WHERE status = 'sending' AND attempts >= 3 AND sending_at <= ?")
        .run(now - 2 * minute);
      db.prepare("UPDATE email_jobs SET status = 'unknown', failure_reason = 'Provider outcome could not be confirmed after a restart.' WHERE status = 'sending' AND sending_at <= ?")
        .run(now - 23 * 60 * minute);
      const due = db.prepare(`SELECT * FROM email_jobs WHERE
        (status = 'scheduled' AND scheduled_at <= ?)
        OR (status = 'sending' AND sending_at <= ? AND attempts < 3)
        ORDER BY scheduled_at LIMIT 10`).all(now, now - 2 * minute);
      for (const job of due) {
        const claimed = db.prepare(`UPDATE email_jobs SET status = 'sending', sending_at = ?, attempts = attempts + 1
          WHERE id = ? AND status = ? AND (sending_at IS ? OR sending_at = ?)`).run(
          clock(), job.id, job.status, job.sending_at, job.sending_at,
        ).changes;
        if (!claimed) continue;
        record(job.id, 'sending');
        try {
          const result = await provider.send({
            to: job.email, subject: job.subject, text: job.body,
            idempotencyKey: `arrival/${job.id}`,
          });
          db.prepare("UPDATE email_jobs SET status = 'sent', provider_id = ?, sent_at = ?, delivery_event = 'accepted', failure_reason = NULL WHERE id = ? AND status = 'sending'")
            .run(result.id, clock(), job.id);
          record(job.id, 'provider_accepted', result.id);
        } catch (error) {
          if (error.outcome === 'rejected') {
            db.prepare("UPDATE email_jobs SET status = 'failed', failed_at = ?, failure_reason = 'Provider rejected the email.' WHERE id = ? AND status = 'sending'")
              .run(clock(), job.id);
            record(job.id, 'provider_rejected');
          } else if (job.attempts + 1 >= 3) {
            db.prepare("UPDATE email_jobs SET status = 'unknown', failure_reason = 'Provider outcome could not be confirmed.' WHERE id = ? AND status = 'sending'")
              .run(job.id);
            record(job.id, 'provider_unconfirmed');
          } else {
            record(job.id, 'provider_retry_pending');
          }
        }
      }
      const pendingOutcomes = db.prepare("SELECT * FROM email_jobs WHERE status = 'sent' AND provider_id IS NOT NULL AND sent_at > ? AND (delivery_checked_at IS NULL OR delivery_checked_at < ?) ORDER BY sent_at LIMIT 10")
        .all(now - 7 * day, now - 5 * minute);
      for (const job of pendingOutcomes) {
        try {
          const outcome = await provider.get(job.provider_id);
          const event = outcome.lastEvent;
          db.prepare('UPDATE email_jobs SET delivery_event = ?, delivery_checked_at = ? WHERE id = ?')
            .run(event || job.delivery_event, clock(), job.id);
          if (event && event !== job.delivery_event) record(job.id, `delivery_${event}`);
          if (['bounced', 'failed', 'complained'].includes(event)) {
            db.prepare("UPDATE email_jobs SET status = 'failed', failed_at = ?, failure_reason = 'Delivery failed after provider acceptance.' WHERE id = ?")
              .run(clock(), job.id);
          }
        } catch {
          db.prepare('UPDATE email_jobs SET delivery_checked_at = ? WHERE id = ?').run(clock(), job.id);
        }
      }
    } finally {
      running = false;
    }
  }

  function prune() {
    const now = clock();
    db.prepare('DELETE FROM email_verifications WHERE created_at < ?').run(now - day);
    db.prepare(`UPDATE email_jobs SET email = NULL, subject = NULL, body = NULL, review_hash = NULL
      WHERE email IS NOT NULL AND status IN ('sent', 'failed', 'cancelled', 'unknown')
      AND COALESCE(sent_at, failed_at, cancelled_at, confirmed_at) < ?`).run(now - personalDataRetention);
    db.prepare('DELETE FROM email_events WHERE at < ?').run(now - 90 * day);
  }

  return { requestVerification, verify, review, schedule, list, cancel, runDue, prune, close: () => db.close() };
}
