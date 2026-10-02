# Linux sandbox for the tools that don't run on native Windows: Halmos, Gambit, Medusa, Echidna.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl git ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

# Foundry: the mutation loop and Halmos drive forge.
ARG FOUNDRY_VERSION=stable
ENV FOUNDRY_DIR=/opt/foundry
ENV PATH="/opt/foundry/bin:${PATH}"
RUN curl -sSL https://foundry.paradigm.xyz | bash && foundryup --install ${FOUNDRY_VERSION}

# Halmos (symbolic execution), solc-select (Gambit needs a plain `solc`), and crytic-compile
# plus Slither, which Medusa and Echidna build on.
RUN pip install --no-cache-dir halmos solc-select crytic-compile slither-analyzer

ARG GAMBIT_VERSION=v1.0.6
RUN curl -sSL -o /usr/local/bin/gambit \
      https://github.com/Certora/gambit/releases/download/${GAMBIT_VERSION}/gambit-linux-${GAMBIT_VERSION} \
 && chmod +x /usr/local/bin/gambit

ARG MEDUSA_VERSION=v1.5.1
RUN curl -sSL https://github.com/crytic/medusa/releases/download/${MEDUSA_VERSION}/medusa-linux-x64.tar.gz \
    | tar -xz -C /usr/local/bin medusa \
 && chmod +x /usr/local/bin/medusa

ARG ECHIDNA_VERSION=2.3.3
RUN curl -sSL https://github.com/crytic/echidna/releases/download/v${ECHIDNA_VERSION}/echidna-${ECHIDNA_VERSION}-x86_64-linux.tar.gz \
    | tar -xz -C /usr/local/bin \
 && chmod +x /usr/local/bin/echidna

WORKDIR /out
