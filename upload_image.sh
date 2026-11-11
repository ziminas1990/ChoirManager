VERSION=0.7.0

docker build --network=host -t ursa-major-agent .
docker tag ursa-major-agent ziminas1990/ursa-major-agent:$VERSION
docker push ziminas1990/ursa-major-agent:$VERSION