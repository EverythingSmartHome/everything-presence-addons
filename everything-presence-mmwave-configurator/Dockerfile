ARG BUILD_FROM=ghcr.io/hassio-addons/base:12.2.1
FROM $BUILD_FROM

ENV LANG C.UTF-8
ENV PIP_ROOT_USER_ACTION=ignore

RUN apk add --no-cache ca-certificates && \
    update-ca-certificates

RUN apk update && \
    apk add --no-cache nginx python3 py3-pip
    
RUN apk add py3-requests py3-flask

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy your application files
COPY www /usr/share/nginx/html

# Copy backend script
COPY backend.py /app/backend.py

# Copy services
COPY services/ /etc/services.d/

# Expose the ingress port
EXPOSE 8099
