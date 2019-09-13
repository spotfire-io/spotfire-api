import { prismaObjectType } from "nexus-prisma";
import _ from "lodash";

export const SolverStatusUpdate = prismaObjectType({
  name: "SolverStatusUpdate",
  definition: t => {
    t.prismaFields(["*"]);
    t.field("constraint_violations", {
      type: "SolverConstraintViolation",
      list: true,
      resolve: root => _.get(root, "constraint_violations", [])
    });
  }
});
