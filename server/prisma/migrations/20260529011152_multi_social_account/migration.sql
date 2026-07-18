-- DropIndex
DROP INDEX "SocialAccount_workspaceId_platform_key";

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "accountLabel" TEXT;
