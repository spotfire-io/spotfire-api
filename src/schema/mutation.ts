import { prismaObjectType } from "nexus-prisma";
import { stringArg, objectType } from "nexus/dist";
import fs from "fs";
import path from "path";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import tmp from "tmp";
import tar from "tar";
import aws from "aws-sdk";
import sha256File from "sha256-file";
import { format as dateFormat } from "date-fns";
import { convertToTimeZone } from "date-fns-timezone";

import { Context, onError } from "../utils";
import * as Prisma from "../generated/prisma-client";
import { gql } from "apollo-server-core";

require("dotenv-flow").config();

const getFragment = name =>
  fs.readFileSync(
    path.resolve(__dirname, `../fragments/${name}.graphql`),
    "utf8"
  );

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

export const Mutation = prismaObjectType({
  name: "Mutation",
  definition: t => {
    t.field("optimizePlaylist", {
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

        const job = await prisma.createOptimizationJob({
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

        return prisma.updateOptimizationJob({
          where: { id: job.id },
          data: { extract_path: extractPath }
        });
      }
    }),
      t.field("loadPlaylistTracks", {
        args: {
          playlist_id: stringArg({
            description: "The playlist ID",
            nullable: false
          }),
          snapshot_id: stringArg({
            description: "The playlist snapshot ID",
            nullable: true
          })
        },
        type: "Playlist",
        resolve: async (
          root,
          { playlist_id, snapshot_id: snapshot_idArg },
          { prisma, spotify, pipelines, limiters }: Context
        ) => {
          if (!spotify) {
            throw new Error("Spotify not authorized");
          }
          if (!pipelines) {
            throw new Error("Pipelines not defined");
          }
          const {
            track: trackPipeline,
            playlist: playlistPipeline
          } = pipelines;
          const spotifyPlaylist = await playlistPipeline.spotifyLoader.load(
            playlist_id
          );
          if (!spotifyPlaylist) {
            throw new Error("Error fetching playlist");
          }
          const playlist = await playlistPipeline
            .mapToPrismaInput(spotifyPlaylist)
            .then(playlistPipeline.upsert);

          if (snapshot_idArg && snapshot_idArg != playlist.latest_snapshot_id) {
            throw new Error(
              `Latest playlist snapshot ID '${
                playlist.latest_snapshot_id
              }' does not match provided snapshot ID '${snapshot_idArg}'`
            );
          }

          const snapshot_id = playlist.latest_snapshot_id;

          const snapshot = await prisma.playlistSnapshot({ snapshot_id });

          const { track_count } = snapshot;
          const pageSize = 100;
          let loadedCount = 0;

          const updatePlaylistSnapshotLoaded = _.throttle(
            async (
              prisma: Prisma.Prisma,
              snapshot_id: string,
              tracksLoaded: number
            ) => {
              const data = { loaded_tracks: tracksLoaded };
              console.log("updatePlaylistSnapshot", data);
              return await prisma.updatePlaylistSnapshot({
                where: { snapshot_id },
                data
              });
            },
            1000
          );

          if (snapshot.status == "INITIALIZED") {
            // clear existing tracks in case there's overlap
            await limiters.prisma.schedule(() =>
              prisma.deleteManyPlaylistTracks({
                snapshot: { snapshot_id }
              })
            );
            for (
              let offset = 0;
              offset < Math.ceil(track_count / pageSize) * pageSize;
              offset += pageSize
            ) {
              const { body } = await limiters.spotify.schedule(
                {
                  id: `playlistTracks:get:${playlist_id}:${offset}:${Math.random().toString(
                    16
                  )}`
                },
                () =>
                  spotify
                    .getPlaylistTracks(playlist_id, {
                      limit: pageSize,
                      offset
                    })
                    .catch(onError)
              );
              await Promise.all(
                body.items.map(
                  async (item: SpotifyWebApi.PlaylistTrack, trackIndex) => {
                    const spotifyTrack = item.track;
                    try {
                      const input = await trackPipeline.mapToPrismaInput(
                        spotifyTrack
                      );
                      const order = offset + trackIndex + 1;
                      await trackPipeline
                        .upsert(input)
                        .then(async track => {
                          console.log(
                            `Adding playlist track ${
                              track.name
                            } (${order}/${track_count})`
                          );
                          const ptInput: Prisma.PlaylistTrackCreateInput = {
                            snapshot: { connect: { snapshot_id } },
                            track: { connect: { id: track.id } },
                            order,
                            ..._.pick(item, "is_local", "added_at")
                          };
                          if (item.added_by) {
                            ptInput.added_by = {
                              connect: await pipelines.user
                                .upsertAndConnect(item.added_by.id)
                                .catch(onError)
                            };
                          }
                          return await limiters.prisma.schedule(
                            {
                              id: `playlistTrack:create:${playlist_id}:${order}:${Math.random().toString(
                                16
                              )}`
                            },
                            () => prisma.createPlaylistTrack(ptInput).track()
                          );
                        })
                        .then(async track => {
                          await pipelines.audioFeatures
                            .upsertAndConnect(track.uri!)
                            .catch(onError);
                          return track;
                        })
                        .then(() =>
                          updatePlaylistSnapshotLoaded(
                            prisma,
                            snapshot_id,
                            ++loadedCount
                          )
                        )
                        .catch(onError);
                    } catch (err) {
                      console.error(
                        `An error occurred loading track ${spotifyTrack.id} (${
                          spotifyTrack.name
                        })`
                      );
                    }
                  }
                )
              );
            }
          }
          console.log(`Done loading playlist ${playlist_id}:${snapshot_id}`);
          return limiters.prisma.schedule(() =>
            prisma.playlist({ playlist_id })
          );
        }
      });
  }
});
