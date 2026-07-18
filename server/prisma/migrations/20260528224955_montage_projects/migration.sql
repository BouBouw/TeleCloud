-- CreateTable
CREATE TABLE "MontageProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'DARK_TRAP',
    "durationMode" TEXT NOT NULL DEFAULT 'AUTO',
    "ratio" TEXT NOT NULL DEFAULT 'LANDSCAPE',
    "audioPath" TEXT,
    "audioDuration" DOUBLE PRECISION,
    "outputPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MontageProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MontageSourceVideo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "localPath" TEXT,
    "duration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MontageSourceVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MontageRenderJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT NOT NULL DEFAULT '',
    "logs" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MontageRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MontageRenderJob_projectId_key" ON "MontageRenderJob"("projectId");

-- AddForeignKey
ALTER TABLE "MontageProject" ADD CONSTRAINT "MontageProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontageSourceVideo" ADD CONSTRAINT "MontageSourceVideo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MontageProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontageRenderJob" ADD CONSTRAINT "MontageRenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MontageProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
