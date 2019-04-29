import * as Prisma from "../src/generated/prisma-client";
import _ from "lodash";

const key = (
  code: string,
  rootNote: Prisma.NoteCreateInput
): Prisma.KeyCreateInput => {
  const mode = code.substr(-1) == "A" ? "MINOR" : "MAJOR";
  return {
    root_note: {
      connect: _.pick(rootNote, "index")
    },
    camelot_code: code,
    mode,
    camelot_position: Number.parseInt(code[0]),
    label: `${rootNote.label}${mode == "MINOR" ? "min" : "Maj"}`
  };
};

async function main() {
  const notes: Prisma.NoteCreateInput[] = [
    "C",
    "D♭",
    "D",
    "E♭",
    "E",
    "F",
    "F♯",
    "G",
    "A♭",
    "A",
    "B♭",
    "B"
  ].map((label, index) => {
    return {
      index,
      label
    };
  });

  await Promise.all(
    notes.map(input =>
      Prisma.prisma.upsertNote({
        where: _.pick(input, "index"),
        create: input,
        update: input
      })
    )
  );

  const noteLookup = _.keyBy(notes, "label");

  const keys: Prisma.KeyCreateInput[] = [
    key("1A", noteLookup["A♭"]),
    key("2A", noteLookup["E♭"]),
    key("3A", noteLookup["B♭"]),
    key("4A", noteLookup["F"]),
    key("5A", noteLookup["C"]),
    key("6A", noteLookup["G"]),
    key("7A", noteLookup["D"]),
    key("8A", noteLookup["A"]),
    key("9A", noteLookup["E"]),
    key("10A", noteLookup["B"]),
    key("11A", noteLookup["F♯"]),
    key("12A", noteLookup["D♭"]),
    key("1B", noteLookup["B"]),
    key("2B", noteLookup["F♯"]),
    key("3B", noteLookup["D♭"]),
    key("4B", noteLookup["A♭"]),
    key("5B", noteLookup["E♭"]),
    key("6B", noteLookup["B♭"]),
    key("7B", noteLookup["F"]),
    key("8B", noteLookup["C"]),
    key("9B", noteLookup["G"]),
    key("10B", noteLookup["D"]),
    key("11B", noteLookup["A"]),
    key("12B", noteLookup["E"])
  ];

  const uniqueLookup = _.groupBy(
    keys,
    key => `${notes[key.root_note!.connect!.index!].label}_${key.mode}`
  );

  if (Object.keys(uniqueLookup).length != 24) {
    console.error("length", Object.keys(uniqueLookup).length);
    console.error("uniqueLookup", uniqueLookup);
    throw new Error("Do not have 24 unique root note and key combinations");
  }

  await Promise.all(
    keys.map(input =>
      Prisma.prisma.upsertKey({
        where: _.pick(input, "camelot_code"),
        update: input,
        create: input
      })
    )
  );
}

main();
