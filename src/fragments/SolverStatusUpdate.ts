import { gql } from "apollo-server-express";

export const SolverStatusUpdate = gql`
  fragment SolverStatusUpdate on SolverStatusUpdate {
    time_millis_spent
    best_score
    job {
      id
    }
    constraint_violations {
      constraint_name
      violation_count
      score_impact
    }
  }
`;
