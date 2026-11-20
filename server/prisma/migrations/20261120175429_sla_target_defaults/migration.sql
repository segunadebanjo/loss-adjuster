-- Default SLA targets (CLAUDE.md section 4). INSERT IGNORE keeps any value an admin has already changed.
INSERT IGNORE INTO `sla_targets` (`key`, `label`, `target_days`, `business_days`, `updated_at`) VALUES
  ('INSPECTION', 'Site inspection after instruction', 2, true, NOW(3)),
  ('PRELIM_REPORT', 'Preliminary report after instruction', 7, false, NOW(3)),
  ('FINAL_REPORT', 'Final report after documents complete', 14, false, NOW(3)),
  ('SIGNOFF', 'Principal sign-off after final report', 3, true, NOW(3));
