import SpotifyWebApi from "spotify-web-api-node";
import * as Prisma from "../generated/prisma-client";
import _ from "lodash";

export class PlaylistPipeline {
  async fetch(
    spotify: SpotifyWebApi,
    id: string
  ): Promise<SpotifyWebApi.Playlist> {
    return spotify.getPlaylist(id).then(resp => resp.body);
  }

  mapToPrisma(
    spotifyPlaylist: SpotifyWebApi.Playlist
  ): Prisma.PlaylistCreateInput {
    return {
      playlist_id: spotifyPlaylist.id,
      latest_snapshot_id: spotifyPlaylist.snapshot_id,
      ..._.pick(spotifyPlaylist, "description", "name", "uri", "public")
    };
  }

  saveToPrisma(prisma: Prisma.Prisma, playlist: Prisma.PlaylistCreateInput) {
    return prisma.upsertPlaylist({
      where: { playlist_id: playlist.playlist_id },
      create: playlist,
      update: playlist
    });
  }
}
