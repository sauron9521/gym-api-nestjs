# Backup monitoring and delivery receipt drill

This is an **opt-in integration**, not an automatic deployment of backup
timers, notification receivers or paging. The existing backup schedule and
isolated restore checks are described in
[backup automation](backup-automation-restore-drill.md).

## Backup health and alerting

The optional `scripts/monitoring-backup-health.mjs` runs the established
`verify-backup-freshness.sh` verifier every 15 minutes. It checks the
most recent backup's age, SHA256 integrity, PostgreSQL archive listing
and avatar archive listing. It atomically writes two fixed, unlabeled
node_exporter gauges:

- `gym_api_backup_last_check_timestamp_seconds` — the time of the last
  attempted check, even when verification fails.
- `gym_api_backup_verified` — 1 only after all checks pass, otherwise 0.

If verification fails, the collector publishes an unhealthy snapshot and
exits with a nonzero status. If collection or publication itself fails,
the last good snapshot stays intact and eventually becomes stale.
This distinction prevents a recent check that failed integrity verification
from appearing healthy.

The Prometheus rules in `ops/monitoring/backup-health.rules.yml` are
deliberately **separate** from the general alerts. Do not load them before
the textfile collector has been provisioned and is being scraped:

| Alert | Trigger |
| --- | --- |
| `GymApiBackupVerificationFailed` | Latest backup failed for five minutes |
| `GymApiBackupHealthSnapshotMissing` | Check metric absent for 30 minutes |
| `GymApiBackupHealthSnapshotStale` | Last check older than 30 minutes for five minutes |

Prometheus/Alertmanager and node_exporter availability themselves need
separate monitoring; a fully unavailable Prometheus cannot notify you.

### Optional host provisioning

The collector needs read-only access to restricted backup files, but
**neither DB credentials nor Docker socket access**. The sample systemd
unit uses root for reading protected backups and runs with a read-only
system filesystem and a single writable metrics directory.

1. Provision node_exporter with
   `--collector.textfile.directory=/var/lib/node_exporter/textfile_collector`.
   Restrict ownership/permissions so untrusted users cannot replace files.
2. Copy `ops/backup/backup-health.env.example` to
   `/etc/gym-api/backup-health.env` as root (mode 0640), and verify the
   actual backup root, metric output location and 26-hour age threshold.
3. Review and install `ops/backup/gym-api-backup-health.service` and
   `ops/backup/gym-api-backup-health.timer` under
   `/etc/systemd/system/`, then explicitly activate:

   ```sh
   sudo systemctl daemon-reload
   sudo systemd-analyze verify /etc/systemd/system/gym-api-backup-health.service
   sudo systemctl start gym-api-backup-health.service
   sudo systemctl enable --now gym-api-backup-health.timer
   systemctl list-timers gym-api-backup-health.timer
   ```

4. Confirm the metrics are visible from the Prometheus scrape target and
   `node_textfile_scrape_error` is zero. Configure the **test receiver**
   before loading the separate backup alert rules. Review alert grouping
   and inhibition to prevent duplicate pages.

The collector uses no dynamic labels and emits no backup paths, credentials,
emails, user IDs or database URLs. A missing or corrupt backup causes a
negative health result, not deletion or restoration.

## Verify actual notification delivery

The existing synthetic Alertmanager drill only proves an API POST was
accepted. An HTTP 200/202 **does not** mean the notification reached anyone.

To validate the actual notification route, use a pre-approved staging-only
receiver. Configure your notification template to include the
`drill_id` label or the drill's annotation so the recipient can compare it
to the sender's receipt record.

1. Obtain permission from the test recipient and inspect the isolated
   Alertmanager route and silences. Avoid broad production paging.
2. Inspect the dry run, which never sends anything:

   ```sh
   npm run monitoring:alert-drill
   ```

3. Submit exactly one authorized test alert (HTTPS except local loopback):

   ```sh
   npm run monitoring:alert-drill -- \\
     --origin https://alertmanager.example.test \\
     --send --acknowledge-test-route
   ```

   The output contains a new random `drillId` but deliberately reports
   `notificationConfirmed: false`.

4. The human recipient checks the received alert contains **the same ID**
   and manually acknowledges receipt. Only **after that**, record a
   sanitized operator attestation:

   ```sh
   node scripts/monitoring-alert-receipt.mjs \\
     --drill-id 70b8db83-12e4-40d5-9b65-2f7c8f5b2d11 \\
     --channel pager --acknowledge-received
   ```

   Replace the example UUID with the actual sender output. Allowed
   channel categories: email, sms, pager, chat or webhook. The JSON
   receipt states `confirmationSource: "operator-attestation"` and
   `independentDeliveryProof: false`, accurately distinguishing human
   acknowledgement from cryptographic or automatic confirmation.

5. Store the sanitized receipt, receiving timestamp, measured delay, test
   route and escalation outcome in **restricted operator evidence storage
   outside GitHub**. Do not store recipient identities, credentials or
   actual messages in the repository.

6. In staging, test the **real backup health alert** by pointing the
   collector to an empty **disposable** backup root, observe
   `gym_api_backup_verified = 0`, verify the alert fires and the test
   receiver actually receives it, restore the authorized root and
   confirm firing resolves. Never delete or corrupt production backups.

**Three separate outcomes:** Alertmanager API accepted a message;
the intended recipient actually received it; and escalation/acknowledgement
worked. Only the latter two can establish operational paging readiness.

## CI and limitations

CI runs offline unit tests for healthy/failed reports and operator receipt
validation, checks systemd unit syntax, and uses `promtool` to test
firing, missing/stale metrics and healthy scenarios. CI never sends a real
notification and has no access to the operator's paging route or inbox.
The repository does not install a production alert receiver or guarantee
backup RPO/RTO.
