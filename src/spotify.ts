import Bottleneck from "bottleneck";
import SpotifyWebApi from "spotify-web-api-node";
import * as _ from "lodash";

import { of, from, empty, Subject } from "rxjs";
import {
  map,
  tap,
  flatMap,
  toArray,
  mapTo,
  expand,
  distinct,
  bufferCount,
  concatMap,
  mergeAll,
  multicast,
  take
} from "rxjs/operators";

import logger from "./logger";
import {
  Playlist as PrismaPlaylist,
  User,
  Prisma,
  ImageUpdateManyInput,
  UserCreateOneInput,
  ReleaseDatePrecision,
  Image,
  Album,
  AlbumCreateInput,
  TrackCreateInput,
  PlaylistTrackCreateInput,
  AudioFeaturesCreateInput,
  UserCreateInput
} from "./generated/prisma-client";
import { exists } from "fs";
import { async } from "rxjs/internal/scheduler/async";

type Playlist = PrismaPlaylist & {
  owner: User;
  track_count: number;
  snapshot_id: string;
};

const limiters = {
  spotify: new Bottleneck({
    maxConcurrent: 16,
    minTime: 200
  }),
  prisma: new Bottleneck({
    maxConcurrent: 64
  })
};

const fields = {
  playlist: [
    "id",
    "name",
    "description",
    "href",
    "public",
    "uri",
    "images",
    "owner(id,href,uri,display_name,country)",
    "snapshot_id",
    "tracks(total)"
  ],
  artist: [
    "id",
    "uri",
    "href",
    "genres",
    "followers",
    "images",
    "name",
    "popularity"
  ],
  playlistTrack: [
    "items(" +
      [
        "added_at",
        "added_by(id)",
        "is_local",
        "track(" +
          [
            "album(id,artists(id))",
            "artists(id)",
            "available_markets",
            "disc_number",
            "duration_ms",
            "explicit",
            "href",
            "id",
            "name",
            "popularity",
            "preview_url",
            "track_number",
            "uri"
          ].join(",") +
          ")"
      ].join(",") +
      ")"
  ]
};

const pageSizes = {
  playlistTrack: 100,
  artist: 50,
  albums: 20,
  audioFeatures: 20
};

const prisma = new Prisma();

const fetchPlaylistTrackPage = (
  spotify: SpotifyWebApi,
  playlistId: string,
  offset: number = 0,
  totalTracks: number
) => {
  const limit = pageSizes.playlistTrack;
  const options = { offset, limit };
  return of(1).pipe(
    tap(() =>
      logger.info("Fetching playlist track page", {
        ...options,
        playlist_id: playlistId
      })
    ),
    mapTo({
      items: limiters.spotify.schedule(async () => {
        return spotify
          .getPlaylistTracks(playlistId, {
            ...options,
            fields: fields.playlistTrack.join(",")
          })
          .then(data => data.body.items);
      }),
      spotify: spotify,
      playlistId: playlistId,
      totalTracks: totalTracks,
      offset: offset + limit < totalTracks ? offset + limit : undefined
    })
  );
};

const fetchPlaylist = async (spotify, playlistId): Promise<any> => {
  return limiters.spotify.schedule(() => {
    logger.info("Getting Spotify Playlist Data", {
      spotify_operation: "getPlaylist",
      playlist_id: playlistId
    });
    return spotify
      .getPlaylist(playlistId, {
        fields: fields.playlist.join(",")
      })
      .then(resp => resp.body);
  });
};

const upserters = {
  user: async (user: SpotifyWebApi.PublicUser | SpotifyWebApi.PrivateUser) => {
    const user_id = user.id;
    const createInput: UserCreateInput = {
      ..._.pick(
        user,
        "birthday",
        "country",
        "display_name",
        "email",
        "href",
        "product",
        "uri"
      ),
      user_id,
      images: {
        connect: user.images.map(i => {
          return { url: i.url };
        })
      }
    };
    return limiters.prisma.schedule(() => {
      return prisma
        .upsertUser({
          where: { user_id },
          create: createInput,
          update: _.omit(createInput, "user_id")
        })
        .catch(e => {
          logger.error(`Error occurred upserting user`, {
            user_id,
            error: e
          });
        });
    });
  },
  images: async (images: SpotifyWebApi.Image[]) => {
    return Promise.all(
      images.map((image: SpotifyWebApi.Image) => {
        return limiters.prisma.schedule(() =>
          prisma.upsertImage({
            where: _.pick(image, "url"),
            create: _.pick(image, ["url", "width", "height"]),
            update: _.pick(image, ["width", "height"])
          })
        );
      })
    );
  },
  markets: async (country_codes: string[]) => {
    const existing = await prisma.markets({
      where: { country_code_in: country_codes }
    });
    const missing = _.difference(
      country_codes,
      _.map(existing, "country_code")
    );
    return Promise.all(
      missing.map(country_code =>
        limiters.prisma.schedule(() =>
          prisma
            .upsertMarket({
              where: { country_code },
              create: { country_code },
              update: {}
            })
            .catch(e => {
              logger.error(`Error occurred upserting Market`, {
                country_code,
                error: e
              });
            })
        )
      )
    );
  },
  genres: async (genres: string[]) => {
    const existing = await prisma.genres({
      where: { name_in: genres }
    });
    const missing = _.difference(genres, _.map(existing, "name"));
    Promise.all(
      missing.map(name =>
        limiters.prisma.schedule(() =>
          prisma
            .upsertGenre({
              where: { name },
              create: { name },
              update: {}
            })
            .catch(e => {
              logger.error(`Error occurred upserting Genre`, {
                name,
                error: e
              });
            })
        )
      )
    );
  }
};

const savePlaylist = async playlist => {
  const playlist_id = playlist.id;
  const snapshot_id = playlist.snapshot_id;
  const snapshotExists = await prisma.$exists.playlistSnapshot({ snapshot_id });
  if (snapshotExists) {
    logger.info("Snapshot already exists, no need to save", {
      playlist_id: playlist.id,
      snapshot_id
    });
  } else {
    const values = _.omit(
      playlist,
      "id",
      "snapshot_id",
      "tracks",
      "images",
      "owner"
    );
    const ownerId = playlist.owner.id;
    const ownerExists = await prisma.$exists.user({ user_id: ownerId });
    if (!ownerExists) {
      upserters.user(playlist.owner);
    }

    const ownerUpsert: UserCreateOneInput = {
      connect: {
        user_id: ownerId
      }
    };

    const imageUpsert: ImageUpdateManyInput = {
      upsert: playlist.images.map(i => {
        return { where: _.pick(i, "url"), create: i, update: {} };
      })
    };

    const snapshotCreate = {
      snapshot_id,
      track_count: playlist.tracks.total
    };

    await prisma
      .upsertPlaylist({
        where: {
          playlist_id
        },
        create: {
          ...values,
          playlist_id,
          owner: ownerUpsert,
          snapshots: {
            create: snapshotCreate
          },
          images: { create: playlist.images }
        },
        update: {
          ...values,
          owner: ownerUpsert,
          snapshots: {
            connect: { snapshot_id },
            create: snapshotCreate
          },
          images: imageUpsert
        }
      })
      .catch(e => {
        logger.error(`Error occurred upserting Playlist`, {
          playlist_id,
          snapshot_id,
          error: e
        });
      });
  }
  return snapshotExists;
};

export const getPlaylist = async (
  spotify: SpotifyWebApi,
  playlist_id: string
) => {
  const playlist = await fetchPlaylist(spotify, playlist_id);
  const snapshot_id = playlist.snapshot_id;

  const savedPlaylist = await savePlaylist(playlist);
  const totalTracks = playlist.tracks.total;
  const maxPage = Math.ceil(totalTracks / pageSizes.playlistTrack);

  const trackSubject = new Subject();

  const tracks = await fetchPlaylistTrackPage(
    spotify,
    playlist_id,
    0,
    totalTracks
  )
    .pipe(
      expand(({ offset, spotify, playlistId, totalTracks }) => {
        return offset
          ? fetchPlaylistTrackPage(spotify, playlistId, offset, totalTracks)
          : empty();
      }),
      concatMap(({ items }) => items),
      mergeAll(),
      tap(item => {
        const track: SpotifyWebApi.Track = item["track"];
        logger.debug("Loaded Track", {
          playlist_id,
          artists: track.artists.map(a => a.name).join(", "),
          name: track.name
        });
      }),
      //   take(totalTracks),
      toArray()
    )
    .toPromise();

  //   logger.info("track", tracks.length);

  const artists = of(...tracks).pipe(
    concatMap(item => {
      const track: SpotifyWebApi.Track = item["track"];
      return [
        ..._.map(track.artists, "id"),
        ..._.map(track.album.artists, "id")
      ];
    }),
    distinct(),
    bufferCount(pageSizes.artist),
    flatMap((artistIds: string[]) =>
      limiters.spotify.schedule(() => {
        return spotify.getArtists(artistIds).then(data => {
          return from(data.body.artists);
        });
      })
    ),
    mergeAll(),
    tap(artist => logger.debug("Loaded Artist", _.pick(artist, "name"))),
    bufferCount(500),
    map(async artists => {
      await upserters.genres(
        _.chain(artists)
          .flatMap("genres")
          .uniq()
          .value()
      );
      await upserters.images(
        _.chain(artists)
          .flatMap("images")
          .value()
      );
      await Promise.all(
        artists.map(artist => {
          const artist_id = artist["id"];
          const prismaArtist = {
            ..._.pick(artist, "uri", "href", "name", "popularity"),
            artist_id,
            images: {
              connect: artist["images"].map(i => {
                return { url: i.url };
              })
            },
            genres: {
              connect: artist["genres"].map(name => {
                return { name };
              })
            }
          };

          return limiters.prisma.schedule(() => {
            logger.info("Upserting Artist", _.pick(prismaArtist, "name"));
            return prisma
              .upsertArtist({
                where: { artist_id },
                create: prismaArtist,
                update: _.omit(prismaArtist, "artist_id")
              })
              .catch(e => {
                logger.error(
                  `Error occurred upserting Artist`,
                  prismaArtist,
                  e
                );
              });
          });
        })
      );
    })
  );

  await artists.toPromise();

  const albums = of(...tracks).pipe(
    map(item => item["track"].album.id),
    distinct(),
    bufferCount(pageSizes.albums),
    flatMap((albumIds: string[]) =>
      limiters.spotify.schedule(() => {
        return spotify.getAlbums(albumIds).then(data => {
          return from(data.body.albums);
        });
      })
    ),
    mergeAll(),
    tap(album => logger.debug("Loaded Album", _.pick(album, "name"))),
    // take(10),
    bufferCount(100),
    map(async albums => {
      await upserters.genres(
        _.chain(albums)
          .flatMap("genres")
          .uniq()
          .value()
      );
      await upserters.images(
        _.chain(albums)
          .flatMap("images")
          .value()
      );
      await upserters.markets(
        _.chain(albums)
          .flatMap("available_markets")
          .value()
      );

      await Promise.all(
        albums.map(album => {
          const album_id = album["id"];
          const prismaAlbum: AlbumCreateInput = {
            ..._.pick(
              album,
              "uri",
              "href",
              "label",
              "name",
              "popularity",
              "release_date"
            ),
            album_id,
            release_date_precision: album[
              "release_date_precision"
            ].toUpperCase(),
            album_type: album["album_type"].toUpperCase(),
            artists: {
              connect: album["artists"].map(a => {
                return { artist_id: a.id };
              })
            },
            images: {
              connect: album["images"].map(i => {
                return { url: i.url };
              })
            },
            genres: {
              connect: album["genres"].map(name => {
                return { name };
              })
            },
            available_markets: {
              connect: album["available_markets"].map(country_code => {
                return { country_code };
              })
            }
          };

          return limiters.prisma.schedule(() => {
            logger.info("Upserting Album", _.pick(prismaAlbum, "name"));
            return prisma
              .upsertAlbum({
                where: { album_id },
                create: prismaAlbum,
                update: _.omit(prismaAlbum, "album_id")
              })
              .catch(e => {
                logger.error(`Error occurred upserting Album`, {
                  ..._.pick(prismaAlbum, "id", "name"),
                  error: e
                });
              });
          });
        })
      );
    })
  );

  await albums.toPromise();

  const trackUpserts = of(...tracks).pipe(
    map(item => {
      const track = item["track"];
      const track_id = track.id;

      const createInput: TrackCreateInput = {
        ..._.pick(
          track,
          "uri",
          "href",
          "disc_number",
          "track_number",
          "duration_ms",
          "explicit",
          "name",
          "popularity",
          "preview_url"
        ),
        track_id,
        album: {
          connect: {
            album_id: track.album.id
          }
        },
        artists: {
          connect: track.artists.map(a => {
            return { artist_id: a.id };
          })
        }
      };
      return limiters.prisma.schedule(() => {
        logger.info("Upserting track", _.pick(track, "name"));
        return prisma
          .upsertTrack({
            where: { track_id },
            create: createInput,
            update: _.omit(createInput, "track_id")
          })
          .catch(e => {
            logger.error(`Error occurred upserting Track`, {
              ..._.pick(track, "id", "name"),
              error: e
            });
          });
      });
    })
  );

  await trackUpserts.toPromise();

  const playlistTrackUpserts = of(...tracks).pipe(
    map((item, i) => {
      const order = i + 1;
      const snapshot_order_id = `${playlist.snapshot_id}:${order}`;
      const createInput: PlaylistTrackCreateInput = {
        ..._.pick(item, "is_local", "added_at"),
        snapshot_order_id,
        order,
        added_by: {
          connect: {
            user_id: item["added_by"]["id"]
          }
        },
        snapshot: {
          connect: {
            snapshot_id: playlist.snapshot_id
          }
        },
        track: {
          connect: {
            track_id: item["track"]["id"]
          }
        }
      };
      return limiters.prisma.schedule(() => {
        logger.info("Upserting playlist track", { snapshot_order_id });
        return prisma
          .upsertPlaylistTrack({
            where: { snapshot_order_id: createInput.snapshot_order_id },
            create: createInput,
            update: _.omit(createInput, "snapshot_order_id")
          })
          .catch(e => {
            logger.error(`Error occurred upserting playlist track`, {
              snapshot_order_id,
              error: e
            });
          });
      });
    })
  );

  const audioFeaturesUpserts = of(...tracks).pipe(
    map(item => item["track"]["id"]),
    bufferCount(pageSizes.audioFeatures),
    flatMap(trackIds => {
      return limiters.spotify.schedule(() => {
        logger.info(`Getting audio features for tracks`, {
          track_count: trackIds.length
        });
        return spotify
          .getAudioFeaturesForTracks(trackIds)
          .then(data => data.body["audio_features"]);
      });
    }),
    mergeAll(),
    map((features: any) => {
      const track_id = features.id;
      const createInput: AudioFeaturesCreateInput = {
        ..._.pick(
          features,
          "uri",
          "danceability",
          "energy",
          "speechiness",
          "acousticness",
          "instrumentalness",
          "liveness",
          "valence",
          "tempo",
          "duration_ms",
          "time_signature"
        ),
        track_id,
        root_note: features.key,
        mode: features.mode == 1 ? "MAJOR" : "MINOR",
        track: {
          connect: {
            track_id: track_id
          }
        }
      };

      limiters.prisma.schedule(() => {
        logger.info("Saving Audio Features", { track_id });
        return prisma
          .upsertAudioFeatures({
            where: { track_id },
            create: createInput,
            update: _.omit(createInput, "track_id")
          })
          .catch(e => {
            logger.error(`Error occurred upserting audio features`, {
              track_id,
              error: e
            });
          });
      });
    })
  );

  await audioFeaturesUpserts.toPromise();
  await playlistTrackUpserts.toPromise();

  const deleted = await prisma.deleteManyPlaylistTracks({
    snapshot: { snapshot_id },
    order_gt: totalTracks
  });
  logger.info("Deleted any extraneous tracks at end of snapshot", {
    snapshot_id,
    order: totalTracks,
    deleted: deleted.count
  });

  return playlist;
};
