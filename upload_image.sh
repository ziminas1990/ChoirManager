docker build --network=host -t ursa-major-agent .
docker tag ursa-major-agent ziminas1990/ursa-major-agent:latest
docker push ziminas1990/ursa-major-agent:latest