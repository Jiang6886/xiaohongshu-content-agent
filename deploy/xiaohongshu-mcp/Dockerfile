# Compile only the service; reuse the pinned image's existing browser/runtime.
FROM golang:1.24@sha256:d2d2bc1c84f7e60d7d2438a3836ae7d0c847f4888464e7ec9ba3a1339a1ee804 AS builder
WORKDIR /src
ARG UPSTREAM_COMMIT=a5c8f7799980ba1fdd501999843eb2d17e4c9a9f
RUN curl -fsSL "https://codeload.github.com/xpzouying/xiaohongshu-mcp/tar.gz/${UPSTREAM_COMMIT}" | tar -xz --strip-components=1
COPY patches/search.patch /tmp/search.patch
RUN git apply /tmp/search.patch
RUN go test ./xiaohongshu -run 'TestCollectFilters' && CGO_ENABLED=0 go build -ldflags='-s -w -X main.version=v2.5.5-shiye.1' -o /out/app .
FROM xpzouying/xiaohongshu-mcp@sha256:5bc690d0c7907f069886ddeb6b37abbe4bdd37bd431975b914c7c27435b1b602
COPY --from=builder /out/app /app/app
