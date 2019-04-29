import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import { autobind } from "ts-class-autobind";

import { Prisma, Key } from "../generated/prisma-client";
import { Limiters } from "../utils";

interface KeyLookupCriteria {
  mode: number;
  key: number;
}

export abstract class Pipeline<
  SpotifyType,
  PrismaType,
  PrimsaCreateType,
  PrismaWhereUniqueInput
> {
  protected prisma: Prisma;
  protected limiters: Limiters;
  protected spotify?: SpotifyWebApi;
  protected prismaKey: string;

  constructor(
    prismaKey: string,
    limiters: Limiters,
    prisma: Prisma,
    spotify?: SpotifyWebApi
  ) {
    this.prismaKey = prismaKey;
    this.limiters = limiters;
    this.prisma = prisma;
    this.spotify = spotify;

    this.keyLoader = new DataLoader(criterias => {
      return Promise.all(
        criterias.map(criteria =>
          this.prisma
            .keys({
              where: {
                mode: criteria.mode == 1 ? "MAJOR" : "MINOR",
                root_note: { index: criteria.key }
              }
            })
            .then(results => {
              if (results.length > 1) {
                throw new Error(
                  `Should only receive one key for criteria ${JSON.stringify(
                    criteria
                  )}`
                );
              }
              return results[0];
            })
        )
      );
    });
  }

  abstract prismaLoader: DataLoader<String, PrismaType | undefined>;
  abstract spotifyLoader?: DataLoader<String, SpotifyType | undefined>;
  keyLoader: DataLoader<KeyLookupCriteria, Key>;

  abstract mapToPrismaInput(
    spotifyVal: SpotifyType
  ): PrimsaCreateType | Promise<PrimsaCreateType>;

  abstract upsert(createObj: PrimsaCreateType): Promise<PrismaType>;

  whereUnique = (
    obj: PrismaType | PrimsaCreateType
  ): PrismaWhereUniqueInput => {
    return <PrismaWhereUniqueInput>_.pick(obj, this.prismaKey);
  };

  upsertAndConnect = async (
    id: String
  ): Promise<PrismaWhereUniqueInput | undefined> => {
    return await this.prismaLoader.load(id).then(async prismaHit => {
      if (prismaHit) {
        return this.whereUnique(prismaHit);
      } else if (this.spotifyLoader) {
        const spotifyHit = await this.spotifyLoader.load(id);
        if (spotifyHit) {
          const input = await this.mapToPrismaInput(spotifyHit);
          const upserted = await this.upsert(input);
          return this.whereUnique(upserted);
        }
      }
      return undefined;
    });
  };
}

export * from "./album";
export * from "./audioFeatures";
export * from "./artist";
export * from "./genre";
export * from "./image";
export * from "./playlist";
export * from "./track";
export * from "./user";
