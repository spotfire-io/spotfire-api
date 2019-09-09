import { gql } from "apollo-server-express";

export const ArtistForOptimization = gql`
  fragment ArtistForOptimization on Artist {
    id
    artist_id
    name
    popularity
    follower_count
    genres {
      name
    }
  }
`;
