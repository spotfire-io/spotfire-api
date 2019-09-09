import { gql } from "apollo-server-express";

export const PlaylistDetails = gql`
  fragment PlaylistDetails on Playlist {
    id
    playlist_id
    name
    description
    latest_snapshot_id
    owner {
      user_id
      display_name
    }
    images {
      url
      width
      height
    }
    href
    uri
    updated_at
    created_at
  }
`;
