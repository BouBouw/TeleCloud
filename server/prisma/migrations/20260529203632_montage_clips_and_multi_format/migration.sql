-- AlterTable
ALTER TABLE "MontageProject" ADD COLUMN     "beatData" TEXT,
ADD COLUMN     "outputPortraitPath" TEXT,
ADD COLUMN     "outputSquarePath" TEXT,
ADD COLUMN     "subtitleData" TEXT;

-- CreateTable
CREATE TABLE "MontageClip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "clipStart" DOUBLE PRECISION NOT NULL,
    "clipEnd" DOUBLE PRECISION NOT NULL,
    "outputStart" DOUBLE PRECISION NOT NULL,
    "outputDuration" DOUBLE PRECISION NOT NULL,
    "effects" TEXT NOT NULL DEFAULT '[]',
    "transition" TEXT NOT NULL DEFAULT 'cut',
    "scoreMotion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreBrightness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreSharpness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreOverall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MontageClip_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MontageClip" ADD CONSTRAINT "MontageClip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MontageProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
