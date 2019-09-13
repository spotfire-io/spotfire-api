import { stringArg } from "nexus/dist";
import { NexusOutputFieldConfig } from "nexus/dist/core";
import fs from "fs";
import _ from "lodash";
import tmp from "tmp";
import tar from "tar";
import aws from "aws-sdk";
import sha256File from "sha256-file";
import { format as dateFormat } from "date-fns";

import { Context } from "../../utils";
import logger from "../../logger";

import { PlaylistSnapshotForOptimization } from "../../fragments/PlaylistSnapshotForOptimization";
import { KeyForOptimization } from "../../fragments/KeyForOptimization";
import { PlaylistTrackForOptimization } from "../../fragments/PlaylistTrackForOptimization";
import { ArtistForOptimization } from "../../fragments/ArtistForOptimization";
import { AlbumForOptimization } from "../../fragments/AlbumForOptimization";
import { PlaylistSnapshot } from "../../generated/prisma-client";

require("dotenv-flow").config();

const s3 = new aws.S3();
const extractBucketName =
  process.env["AWS_S3_EXTRACT_BUCKET_NAME"] || "spotfire-extracts";

const writeToJsonFile = path => {
  return obj => {
    if (_.isArray(obj)) {
      const arr: any[] = obj;
      fs.open(path, "w", (err, fd) =>
        arr.forEach(item => fs.appendFileSync(fd, `${JSON.stringify(item)}\n`))
      );
    } else {
      fs.writeFileSync(path, JSON.stringify(obj));
    }
  };
};

export const startPlaylistOptimization: NexusOutputFieldConfig<
  "Mutation",
  "optimizePlaylist"
> = {
  type: "OptimizationJob",
  args: {
    playlist_id: stringArg({
      description: "The playlist ID",
      nullable: false
    }),
    snapshot_id: stringArg({
      description: "The playlist snapshot ID",
      nullable: false
    }),
    playlist_name: stringArg({
      description: "The name for the new playlist",
      nullable: true
    })
  },
  resolve: async (
    root,
    { playlist_id, snapshot_id, playlist_name },
    { prisma, spotify, pipelines, limiters }: Context
  ) => {
    const jobStart = new Date();
    const snapshotPromise = limiters.prisma.schedule(() =>
      prisma
        .playlistSnapshot({ snapshot_id })
        .$fragment<PlaylistSnapshot>(PlaylistSnapshotForOptimization)
    );
    const snapshot = await snapshotPromise;
    if (!snapshot) {
      throw Error("Snapshot not found");
    }

    logger.info("Creating optimization job for snapshot", { snapshot_id });

    let job = await prisma.createOptimizationJob({
      original_playlist_snapshot: { connect: { snapshot_id } },
      start: new Date(),
      status: "TRACKS_LOADED",
      playlist_name: playlist_name || `Unnamed Spotfired Playlist`
    });

    const { name: tmpDir, removeCallback: dirCleanup } = tmp.dirSync();

    writeToJsonFile(`${tmpDir}/playlistSnapshot.json`)(snapshot);

    await Promise.all([
      limiters.prisma
        .schedule(() => prisma.keys().$fragment(KeyForOptimization))
        .then(writeToJsonFile(`${tmpDir}/keys.jsonl`)),
      limiters.prisma
        .schedule(async () =>
          prisma
            .playlistTracks({
              where: { snapshot: { snapshot_id } },
              orderBy: "order_ASC"
            })
            .$fragment(PlaylistTrackForOptimization)
        )
        .then(writeToJsonFile(`${tmpDir}/playlistTracks.jsonl`)),
      limiters.prisma
        .schedule(async () =>
          prisma
            .artists({
              where: {
                OR: [
                  {
                    tracks_some: {
                      playlist_tracks_some: { snapshot: { snapshot_id } }
                    }
                  },
                  {
                    albums_some: {
                      tracks_some: {
                        playlist_tracks_some: { snapshot: { snapshot_id } }
                      }
                    }
                  }
                ]
              }
            })
            .$fragment(ArtistForOptimization)
        )
        .then(writeToJsonFile(`${tmpDir}/artists.jsonl`)),
      limiters.prisma
        .schedule(async () =>
          prisma
            .albums({
              where: {
                tracks_some: {
                  playlist_tracks_some: { snapshot: { snapshot_id } }
                }
              }
            })
            .$fragment(AlbumForOptimization)
        )
        .then(writeToJsonFile(`${tmpDir}/albums.jsonl`))
    ]);

    const { name: tarFilePath, removeCallback: tarCleanup } = tmp.fileSync({
      postfix: ".tar.gz"
    });

    await tar.c(
      {
        gzip: true,
        cwd: tmpDir,
        file: tarFilePath
      },
      ["."]
    );

    dirCleanup();

    const tarHash = sha256File(tarFilePath);
    const s3Key = `${tarHash}.tar.gz`;
    const s3Tags = {
      PlaylistId: playlist_id,
      SnapshotId: snapshot_id,
      JobStart: dateFormat(jobStart)
    };
    const s3TagStr = Object.keys(s3Tags)
      .map(key => `${key}=${s3Tags[key]}`)
      .join("&");

    await fs.readFile(tarFilePath, async (err, data: Buffer) => {
      if (err) {
        throw err;
      }
      const result = await s3
        .putObject({
          Bucket: extractBucketName,
          Key: s3Key,
          Body: data,
          // this is safe so long as bucket listing is private and the
          // filename is obscured by the SHA of its contents
          ACL: "public-read",
          Tagging: s3TagStr
        })
        .promise();

      if (result.$response.error) {
        throw new Error("Error uploading file: ${result.$response.error}");
      }
    });

    const extractPath = `https://s3.amazonaws.com/${extractBucketName}/${s3Key}`;

    job = await prisma.updateOptimizationJob({
      where: { id: job.id },
      data: { extract_path: extractPath, status: "EXTRACT_UPLOADED" }
    });

    return job;
  }
};

export default startPlaylistOptimization;
