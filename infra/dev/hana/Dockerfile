# SAP HANA Express 原样镜像，只把启动与健康检查脚本放进去；基础镜像按 digest 固定，只在这里改。
ARG BASE_IMAGE=saplabs/hanaexpress:2.00.088.00.20251110.1@sha256:432be2785506e97cefc413f495393fc22fcdda034c2c80db2f0f88efeb16dfaf
FROM ${BASE_IMAGE}

COPY start.sh health.sh /eq/
