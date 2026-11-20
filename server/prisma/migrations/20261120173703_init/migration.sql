-- CreateTable
CREATE TABLE `organisations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('INSURER', 'BROKER') NOT NULL,
    `naicom_licence_no` VARCHAR(64) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `address` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `organisations_name_type_key`(`name`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(100) NOT NULL,
    `role` ENUM('ADMIN', 'ADJUSTER', 'INSURER') NOT NULL,
    `phone` VARCHAR(32) NULL,
    `naicom_license_no` VARCHAR(64) NULL,
    `cii_qualification` VARCHAR(64) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `organisation_id` INTEGER NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `policy_number` VARCHAR(64) NOT NULL,
    `naicom_uid` VARCHAR(64) NOT NULL,
    `insurer_org_id` INTEGER NOT NULL,
    `broker_org_id` INTEGER NULL,
    `insurer_name` VARCHAR(191) NOT NULL,
    `broker_name` VARCHAR(191) NULL,
    `insured_name` VARCHAR(191) NOT NULL,
    `insured_contact` VARCHAR(255) NULL,
    `policy_type` ENUM('MOTOR', 'PROPERTY_FIRE', 'MARINE_CARGO', 'OIL_AND_GAS', 'ENGINEERING_CAR', 'GENERAL_ACCIDENT') NOT NULL,
    `sum_insured` DECIMAL(15, 2) NOT NULL,
    `excess_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `excess_percentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `policies_naicom_uid_key`(`naicom_uid`),
    INDEX `policies_broker_org_id_idx`(`broker_org_id`),
    UNIQUE INDEX `policies_insurer_org_id_policy_number_key`(`insurer_org_id`, `policy_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claim_sequences` (
    `year` INTEGER NOT NULL,
    `last_no` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_reference` VARCHAR(32) NOT NULL,
    `policy_id` INTEGER NOT NULL,
    `assigned_adjuster_id` INTEGER NULL,
    `insurer_claim_no` VARCHAR(64) NULL,
    `date_of_loss` DATE NOT NULL,
    `date_instructed` DATE NOT NULL,
    `loss_state` VARCHAR(32) NOT NULL,
    `loss_lga` VARCHAR(64) NULL,
    `loss_address` VARCHAR(500) NOT NULL,
    `incident_description` TEXT NOT NULL,
    `status` ENUM('NEW_INSTRUCTION', 'INSPECTION_SCHEDULED', 'UNDER_INVESTIGATION', 'PRELIM_REPORT_SUBMITTED', 'AWAITING_DOCUMENTS', 'FINAL_REPORT_DRAFTED', 'PENDING_SIGNOFF', 'SETTLED', 'REPUDIATED') NOT NULL DEFAULT 'NEW_INSTRUCTION',
    `initial_reserve` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `value_at_risk` DECIMAL(15, 2) NULL,
    `apply_average` BOOLEAN NOT NULL DEFAULT false,
    `recommended_settlement` DECIMAL(15, 2) NULL,
    `settled_amount` DECIMAL(15, 2) NULL,
    `adjuster_fee` DECIMAL(15, 2) NULL,
    `repudiation_reason` TEXT NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `claims_claim_reference_key`(`claim_reference`),
    INDEX `claims_status_idx`(`status`),
    INDEX `claims_assigned_adjuster_id_idx`(`assigned_adjuster_id`),
    INDEX `claims_policy_id_idx`(`policy_id`),
    INDEX `claims_date_instructed_idx`(`date_instructed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claim_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `from_status` ENUM('NEW_INSTRUCTION', 'INSPECTION_SCHEDULED', 'UNDER_INVESTIGATION', 'PRELIM_REPORT_SUBMITTED', 'AWAITING_DOCUMENTS', 'FINAL_REPORT_DRAFTED', 'PENDING_SIGNOFF', 'SETTLED', 'REPUDIATED') NULL,
    `to_status` ENUM('NEW_INSTRUCTION', 'INSPECTION_SCHEDULED', 'UNDER_INVESTIGATION', 'PRELIM_REPORT_SUBMITTED', 'AWAITING_DOCUMENTS', 'FINAL_REPORT_DRAFTED', 'PENDING_SIGNOFF', 'SETTLED', 'REPUDIATED') NOT NULL,
    `changed_by` INTEGER NULL,
    `reason` TEXT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `claim_status_history_claim_id_changed_at_idx`(`claim_id`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `adjuster_id` INTEGER NOT NULL,
    `scheduled_date` DATETIME(3) NOT NULL,
    `completed_date` DATETIME(3) NULL,
    `gps_latitude` DECIMAL(9, 6) NULL,
    `gps_longitude` DECIMAL(9, 6) NULL,
    `site_notes` TEXT NULL,
    `cause_of_loss_verified` BOOLEAN NOT NULL DEFAULT false,
    `policy_liability_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `third_party_involvement` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inspections_claim_id_idx`(`claim_id`),
    INDEX `inspections_adjuster_id_scheduled_date_idx`(`adjuster_id`, `scheduled_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `uploaded_by` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `storage_driver` ENUM('CLOUDINARY', 'S3') NOT NULL,
    `cloud_public_id` VARCHAR(512) NOT NULL,
    `file_url` VARCHAR(1024) NOT NULL,
    `thumbnail_url` VARCHAR(1024) NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `file_type` ENUM('PHOTO', 'DOCUMENT', 'INVOICE', 'VIDEO') NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `caption` VARCHAR(500) NULL,
    `visible_to_insurer` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `evidence_files_claim_id_idx`(`claim_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `valuation_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `item_description` VARCHAR(500) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `claimed_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `assessed_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `depreciation_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `betterment_deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `net_payable` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `adjuster_notes` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `valuation_items_claim_id_sort_order_idx`(`claim_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `type` ENUM('PRELIMINARY', 'FINAL') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `body` JSON NOT NULL,
    `figures` JSON NULL,
    `drafted_by` INTEGER NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `reviewed_by` INTEGER NULL,
    `reviewed_at` DATETIME(3) NULL,
    `return_reason` TEXT NULL,
    `pdf_url` VARCHAR(1024) NULL,
    `pdf_sha256` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reports_claim_id_type_version_key`(`claim_id`, `type`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_notes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NOT NULL,
    `fee_note_no` VARCHAR(32) NOT NULL,
    `professional_fee` DECIMAL(15, 2) NOT NULL,
    `expenses` JSON NOT NULL,
    `vat_rate` DECIMAL(5, 2) NOT NULL,
    `wht_rate` DECIMAL(5, 2) NOT NULL,
    `gross_amount` DECIMAL(15, 2) NOT NULL,
    `vat_amount` DECIMAL(15, 2) NOT NULL,
    `wht_amount` DECIMAL(15, 2) NOT NULL,
    `net_payable` DECIMAL(15, 2) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `issued_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `pdf_url` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fee_notes_fee_note_no_key`(`fee_note_no`),
    INDEX `fee_notes_claim_id_idx`(`claim_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_targets` (
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `target_days` INTEGER NOT NULL,
    `business_days` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` INTEGER NULL,
    `details` JSON NULL,
    `ip_address` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_claim_id_created_at_idx`(`claim_id`, `created_at`),
    INDEX `audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_organisation_id_fkey` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policies` ADD CONSTRAINT `policies_insurer_org_id_fkey` FOREIGN KEY (`insurer_org_id`) REFERENCES `organisations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policies` ADD CONSTRAINT `policies_broker_org_id_fkey` FOREIGN KEY (`broker_org_id`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_assigned_adjuster_id_fkey` FOREIGN KEY (`assigned_adjuster_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_status_history` ADD CONSTRAINT `claim_status_history_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_status_history` ADD CONSTRAINT `claim_status_history_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_adjuster_id_fkey` FOREIGN KEY (`adjuster_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_files` ADD CONSTRAINT `evidence_files_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_files` ADD CONSTRAINT `evidence_files_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `valuation_items` ADD CONSTRAINT `valuation_items_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_drafted_by_fkey` FOREIGN KEY (`drafted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_notes` ADD CONSTRAINT `fee_notes_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_claim_id_fkey` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
