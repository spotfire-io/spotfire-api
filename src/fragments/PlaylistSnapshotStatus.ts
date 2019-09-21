import { gql } from "apollo-server-express";

export const PlaylistSnapshotStatus = gql`
  fragment PlaylistSnapshotForOptimization on PlaylistSnapshot {
    snapshot_id
    status
    track_count
    loaded_tracks
  }
`;
