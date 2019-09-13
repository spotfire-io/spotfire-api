import { prismaObjectType } from "nexus-prisma";
import { stringArg, booleanArg, subscriptionField } from "nexus/dist";
import { Context, getSpotifyIfExists, getPipelinesIfExists } from "../utils";
import _ from "lodash";
import { PlaylistDetails } from "../fragments/PlaylistDetails";
import {
  OptimizationJob as PrismaOptimizationJob,
  SolverStatusUpdate as PrismaSolverStatusUpdat
} from "../generated/prisma-client/";
import { SolverStatusUpdate as SolverStatusUpdateFragment } from "../fragments/SolverStatusUpdate";

export const OptimizationJob = prismaObjectType({
  name: "OptimizationJob",
  definition: t => {
    t.prismaFields(["*"]);
    t.field("latest_status_update", {
      type: "SolverStatusUpdate",
      nullable: true,
      resolve: async (
        job: PrismaOptimizationJob,
        args,
        { prisma }: Context
      ) => {
        return prisma
          .solverStatusUpdates({
            where: { job: { id: job.id } },
            orderBy: "time_millis_spent_DESC",
            first: 1
          })
          .$fragment(SolverStatusUpdateFragment)
          .then(u => (u ? u[0] : null));
      }
    });
  }
});
