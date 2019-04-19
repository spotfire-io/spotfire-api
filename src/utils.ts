import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import { Prisma } from "./generated/prisma-client";

export interface Context {
  spotify: SpotifyWebApi;
  prisma: Prisma;
}

export const nullToUndefined = value => {
  if (_.isPlainObject(value)) {
    return _.mapValues(value, nullToUndefined);
  }
  if (_.isArray(value)) {
    return value.map(nullToUndefined);
  }
  if (value === null) {
    return undefined; // THIS SHOULD BE UNDEFINED
  }
  return value;
};
