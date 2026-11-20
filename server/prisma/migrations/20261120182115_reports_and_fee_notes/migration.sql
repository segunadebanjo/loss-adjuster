-- AlterTable
ALTER TABLE `fee_notes` ADD COLUMN `cancel_reason` TEXT NULL,
    ADD COLUMN `created_by` INTEGER NULL,
    ADD COLUMN `issued_by` INTEGER NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `payment_reference` VARCHAR(128) NULL,
    ADD COLUMN `pdf_data` MEDIUMBLOB NULL,
    ADD COLUMN `pdf_sha256` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `reports` ADD COLUMN `pdf_data` MEDIUMBLOB NULL,
    ADD COLUMN `self_approval_note` TEXT NULL;

-- CreateTable
CREATE TABLE `document_sequences` (
    `kind` VARCHAR(16) NOT NULL,
    `year` INTEGER NOT NULL,
    `last_no` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`kind`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
