/*
  Warnings:

  - Added the required column `sha256` to the `evidence_files` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `evidence_files` ADD COLUMN `sha256` CHAR(64) NOT NULL,
    MODIFY `storage_driver` ENUM('CLOUDINARY', 'S3', 'LOCAL') NOT NULL;
