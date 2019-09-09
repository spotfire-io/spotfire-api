import { prismaObjectType } from "nexus-prisma";
import { Context } from "../utils";
import { roots } from "protobufjs";
import { enumType } from "nexus/dist";

export const Image = prismaObjectType({
  name: "Image",
  definition: t => {
    t.prismaFields({ filter: ["id"] });
  }
});
