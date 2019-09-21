JENKINS       ?= false
KUBE_REGION   ?= eastus
IMAGE_REPO    ?= spotfire/
IMAGE_NAME    := spotfire-api
IMAGE_TAG     := latest

BRANCH_NAME ?= $(if $(GIT_BRANCH),$(GIT_BRANCH),$(shell git symbolic-ref --short HEAD))
GIT_SHA     ?= $(if $(GIT_COMMIT),$(GIT_COMMIT),$(shell git rev-parse HEAD))
ENV_NAME    ?= development

IMAGE_CACHE :=

COMMIT_IMAGE_SPEC = $(if $(IMAGE_REPO),$(IMAGE_REPO)$(IMAGE_NAME):$(GIT_SHA),$(IMAGE_NAME):$(GIT_SHA))
IMAGE_SPEC        = $(if $(IMAGE_REPO),$(IMAGE_REPO)$(IMAGE_NAME):$(IMAGE_TAG),$(IMAGE_NAME):$(IMAGE_TAG))
LATEST_IMAGE_SPEC = $(if $(IMAGE_REPO),$(IMAGE_REPO)$(IMAGE_NAME):latest,$(IMAGE_NAME):latest)

kubeconfig:
	kubectl config use-context $(KUBE_CONTEXT)

## dotenv-encrypt: encrypts your .env files using sops
dotenv-encrypt:
	sops -e --input-type dotenv .env.dev > .env.dev.enc
	sops -e --input-type dotenv .env.production > .env.production.enc

## dotenv-decrypt: encrypts your .env files using sops
dotenv-decrypt:
	sops -d --input-type json --output-type dotenv .env.dev.enc > .env.dev
	sops -d --input-type json --output-type dotenv .env.production.enc > .env.production

registry-login:
	docker login

## build-image: Build a docker image with the :latest tag
build-image: IMAGE_TAG=latest
build-image: build-image-commit
	docker tag $(COMMIT_IMAGE_SPEC) $(IMAGE_SPEC)

## build-image-branch: builds a docker image with the branch name as it's tag
build-image-branch: IMAGE_TAG=$(subst /,-,$(BRANCH_NAME))
build-image-branch: build-image-commit
build-image-branch:
	docker tag $(COMMIT_IMAGE_SPEC) $(IMAGE_SPEC)

## build-image-commit: builds a docker image with the GIT SHA as it's tag
build-image-commit: IMAGE_TAG=$(GIT_SHA)
build-image-commit: pull-image
	docker build \
		$(if $(IMAGE_CACHE),--cache-from $(IMAGE_CACHE),) \
		--pull \
		-t $(COMMIT_IMAGE_SPEC) .

pull-image:
	$(if $(IMAGE_CACHE),docker pull $(IMAGE_CACHE),@echo "Caching disabled, not pulling image")

pull-image-latest:
	docker pull $(LATEST_IMAGE_SPEC)

## push-image: pushes the :latest image to the defined registry
push-image: IMAGE_TAG=latest
push-image: build-image
	docker push $(IMAGE_SPEC)

## push-image-commit: pushes the GIT SHA tag to the defined registry
push-image-commit: build-image-commit
	docker push $(COMMIT_IMAGE_SPEC)

## push-image-branch: pushes the Feature Branch tag to the defined registry
push-image-branch: IMAGE_TAG=$(subst /,-,$(BRANCH_NAME))
push-image-branch: build-image-branch
	docker push $(IMAGE_SPEC)
