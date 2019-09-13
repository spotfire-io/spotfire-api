import { Prisma } from "./generated/prisma-client";

require("dotenv-flow").config();

const prisma = new Prisma({
    endpoint: process.env["PRISMA_ENDPOINT"] || "http://localhost:4466",
    secret: process.env["PRISMA_MANAGEMENT_API_SECRET"] || "",
});

