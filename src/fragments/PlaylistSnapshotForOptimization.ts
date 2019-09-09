import { gql } from "apollo-server-express";

export const PlaylistSnapshotForOptimization = gql`
  fragment PlaylistSnapshotForOptimization on PlaylistSnapshot {
    id
    snapshot_id
    track_count
    loaded_tracks
    playlist {
      id
      playlist_id
      name
      owner {
        user_id
        display_name
      }
      href
      updated_at
      created_at
    }
  }
`;
