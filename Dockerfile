FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		git \
		openssh-client \
		wget \
	&& rm -rf /var/lib/apt/lists/*

# 日本語入力・表示のためロケールを設定（未生成だと Bash がマルチバイトを扱えない）
ENV LANG=en_US.UTF-8 \
	LC_ALL=en_US.UTF-8

# Install .NET 10 SDK via Microsoft package repository (Debian 12 / bookworm)
RUN wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/packages-microsoft-prod.deb \
	&& dpkg -i /tmp/packages-microsoft-prod.deb \
	&& rm /tmp/packages-microsoft-prod.deb \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends dotnet-sdk-10.0 \
	&& rm -rf /var/lib/apt/lists/*

RUN rm -rf /usr/local/lib/node_modules/@anthropic-ai \
	&& npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY . .

CMD ["claude", "--help"]
