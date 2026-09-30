FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		git \
		locales \
		openssh-client \
		wget \
	&& sed -i 's/^# *\(en_US.UTF-8\)/\1/; s/^# *\(ja_JP.UTF-8\)/\1/' /etc/locale.gen \
	&& locale-gen \
	&& rm -rf /var/lib/apt/lists/*

# VS Code拡張機能「Markdown PDF」が使うヘッドレスChromiumの実行に必要な共有ライブラリと、
# PDF内の日本語文字化け（豆腐化）を防ぐための日本語フォント
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libglib2.0-0 \
		libnss3 \
		libatk1.0-0 \
		libatk-bridge2.0-0 \
		libgbm1 \
		libgtk-3-0 \
		libasound2 \
		libx11-xcb1 \
		libxcomposite1 \
		libxdamage1 \
		libxrandr2 \
		libxkbcommon0 \
		libpango-1.0-0 \
		libcairo2 \
		libcups2 \
		fonts-noto-cjk \
		fonts-ipaexfont \
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
