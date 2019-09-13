import { prismaObjectType } from "nexus-prisma";
import { NexusObjectTypeDef } from "nexus/dist/core";
import { PrismaObjectTypeNames, PickInputField } from "nexus-prisma/dist/types";
import changeCase from "change-case";

export * from "./query";
export * from "./mutation";
export * from "./subscription";
export * from "./playlist";
export * from "./image";
export * from "./optimizationJob";
export * from "./solverStatusUpdate";

const overrideTypeId = (
  typeName: PrismaObjectTypeNames,
  prismaIdField: string = `${changeCase.snakeCase(typeName)}_id`
) => {
  return prismaObjectType({
    name: typeName,
    definition: t => {
      t.prismaFields({
        filter: fields => fields.filter(f => f != "id" && f != prismaIdField)
      });
      t.string("id", {
        resolve: root => {
          return root[prismaIdField] || root.id;
        }
      });
    }
  });
};

export const Artist = overrideTypeId("Artist");
export const Album = overrideTypeId("Album");
export const User = overrideTypeId("User");
export const Track = overrideTypeId("Track");
export const PlaylistSnapshot = overrideTypeId(
  "PlaylistSnapshot",
  "snapshot_id"
);
