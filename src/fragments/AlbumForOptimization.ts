import { gql } from "apollo-server-express";

export const AlbumForOptimization = gql`
  fragment AlbumForOptimization on Album {
    id
    album_id
    album_type
    artists {
      id
      artist_id
    }
    label
    name
    release_date
    release_date_precision
    popularity
    genres {
      name
    }
  }
`;
