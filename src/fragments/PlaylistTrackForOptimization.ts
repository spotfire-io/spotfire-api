import { gql } from "apollo-server-express";

export const PlaylistTrackForOptimization = gql`
  fragment PlaylistTrackForOptimization on PlaylistTrack {
    id
    order
    track {
      id
      track_id
      album {
        id
        album_id
      }
      artists {
        id
        artist_id
      }
      name
      duration_ms
      explicit
      popularity
      track_number
      features {
        tempo
        key {
          label
        }
        time_signature
        danceability
        energy
        speechiness
        acousticness
        instrumentalness
        liveness
        valence
      }
    }
  }
`;
