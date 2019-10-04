#Spotfire API

The Spotfire API provides the public graphql interface for the [`Spotfire Website`](https://spotfire.io).

#Requirements
1. AWS Account. You need to have your AWS account created and an AWS profile locally (aws configure --profile).
This profile needs to be exported (`export AWS_PROFILE=yourprofile`). Also, you need access to the KMS key in
your AWS account.
2. Docker
3. ASDF
4. A Spotify Account
5. Access to Docker Hub that has the docker containers for Spotfire


#Setup
1. `asdf install` to install the required tools specified in the `.tool-versions` file.
2.  Export NODE_ENV=dev
3. `make dotenv-decrypt` (this will create an `.env.dev` file)
4. `yarn prisma-deploy`
5. `yarn prisma-generate` to generate graphql types
6.  `yarn start` to start the API in your local machine or  `yarn dev` to get real time compilation after every change to the source.

#Optional Steps
7. `yarn prisma-playground` (opens a prism playground that is authenticated). This allows you to make graphql queries
and mutations on the running prisma server.



#Deployment
1. `make push-image-commit` - will build a docker image that contains the api.
2. `helmfile -e production diff` - this will display a diff of the changes that will be deployed to production.
3. `helmfile -e production apply` - if you are happy with the `diff` you can now deploy to production. This will upload
the image produced from step 1 to the k8 cluster.
