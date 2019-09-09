import { gql } from "apollo-server-express";

export const KeyForOptimization = gql`
  fragment KeyForOptimization on Key {
    id
    label
    root_note {
      label
    }
    mode
    camelot_position
    camelot_code
  }
`;
