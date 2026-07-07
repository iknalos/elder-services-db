#!/bin/bash
set -e
cd /
for f in /migrations/0001_extensions_orgs.sql \
         /migrations/0002_staff_clients.sql \
         /migrations/0003_referrals_assessments.sql \
         /migrations/0004_providers_deliveries_billing.sql \
         /migrations/0005_self_direction_payroll.sql \
         /migrations/0006_reporting_views.sql
do
  echo "===== $f ====="
  psql -U postgres -d elder_services -v ON_ERROR_STOP=1 -f "$f"
done
echo "ALL MIGRATIONS OK"
psql -U postgres -d elder_services -c "\dt"