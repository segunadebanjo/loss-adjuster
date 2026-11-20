-- AlterTable
ALTER TABLE `claims` ADD COLUMN `co_adjuster_firm` VARCHAR(191) NULL,
    ADD COLUMN `co_adjuster_naicom_no` VARCHAR(64) NULL,
    ADD COLUMN `co_adjuster_split_percent` DECIMAL(5, 2) NULL;

-- AlterTable
ALTER TABLE `policies` ADD COLUMN `lead_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE `reports` ADD COLUMN `approval_tier_label` VARCHAR(100) NULL,
    ADD COLUMN `required_approvals` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `policy_co_insurers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `policy_id` INTEGER NOT NULL,
    `organisation_id` INTEGER NOT NULL,
    `insurer_name` VARCHAR(191) NOT NULL,
    `share_percent` DECIMAL(5, 2) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `policy_co_insurers_policy_id_organisation_id_key`(`policy_id`, `organisation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_approvals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `approved_by` INTEGER NOT NULL,
    `note` TEXT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_approvals_report_id_idx`(`report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_tiers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(100) NOT NULL,
    `min_amount` DECIMAL(15, 2) NOT NULL,
    `required_approvals` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `approval_tiers_min_amount_key`(`min_amount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `policy_co_insurers` ADD CONSTRAINT `policy_co_insurers_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_co_insurers` ADD CONSTRAINT `policy_co_insurers_organisation_id_fkey` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_approvals` ADD CONSTRAINT `report_approvals_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_approvals` ADD CONSTRAINT `report_approvals_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Starting approval matrix (editable by a principal): up to NGN 49,999,999.99 one sign-off, NGN 50m and above two.
INSERT INTO `approval_tiers` (`label`, `min_amount`, `required_approvals`, `updated_at`) VALUES
  ('Standard', 0.00, 1, CURRENT_TIMESTAMP(3)),
  ('Large loss', 50000000.00, 2, CURRENT_TIMESTAMP(3));

-- Existing sign-offs become approval rows, so every approved report has its approver on record.
INSERT INTO `report_approvals` (`report_id`, `approved_by`, `note`, `created_at`)
  SELECT `id`, `reviewed_by`, `self_approval_note`, COALESCE(`reviewed_at`, CURRENT_TIMESTAMP(3)) FROM `reports`
  WHERE `status` = 'APPROVED' AND `reviewed_by` IS NOT NULL;
