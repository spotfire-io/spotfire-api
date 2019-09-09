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

import { getFragment } from "../utils";

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

const optimizePlaylist: NexusOutputFieldConfig<
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
    })
  },
  resolve: async (
    root,
    { playlist_id, snapshot_id },
    { prisma, spotify, pipelines, limiters }: Context
  ) => {
    const jobStart = new Date();
    const snapshot = await limiters.prisma.schedule(() =>
      prisma
        .playlistSnapshot({ snapshot_id })
        .$fragment(getFragment("PlaylistSnapshotForOptimization"))
    );
    if (!snapshot) {
      throw Error("Snapshot not found");
    }

    let job = await prisma.createOptimizationJob({
      original_playlist_snapshot: { connect: { snapshot_id } },
      start: new Date(),
      status: "INITIALIZED"
    });

    const { name: tmpDir, removeCallback: dirCleanup } = tmp.dirSync();

    writeToJsonFile(`${tmpDir}/playlistSnapshot.json`)(snapshot);

    await Promise.all([
      limiters.prisma
        .schedule(() =>
          prisma.keys().$fragment(getFragment("KeyForOptimization"))
        )
        .then(writeToJsonFile(`${tmpDir}/keys.jsonl`)),
      limiters.prisma
        .schedule(async () =>
          prisma
            .playlistTracks({
              where: { snapshot: { snapshot_id } },
              orderBy: "order_ASC"
            })
            .$fragment(getFragment("PlaylistTrackForOptimization"))
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
            .$fragment(await getFragment("ArtistForOptimization"))
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
            .$fragment(await getFragment("AlbumForOptimization"))
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

    await fs.readFile(tarFilePath, (err, data: Buffer) => {
      if (err) {
        throw err;
      }
      s3.putObject({
        Bucket: extractBucketName,
        Key: s3Key,
        Body: data,
        // this is safe so long as bucket listing is private and the
        // filename is obscured by the SHA of its contents
        ACL: "public-read",
        Tagging: s3TagStr
      }).promise();
    });

    const extractPath = `https://s3.amazonaws.com/${extractBucketName}/${s3Key}`;

    job = await prisma.updateOptimizationJob({
      where: { id: job.id },
      data: { extract_path: extractPath }
    });

    return job;
  }
};

export default optimizePlaylist;
