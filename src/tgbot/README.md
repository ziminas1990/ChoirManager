## Update and run

To update:
```bash
docker run -ti --network=host -v $(pwd):/mnt/ ursa-major-agent
docker tag ursa-major-agent ziminas1990/ursa-major-agent:latest
docker push ziminas1990/ursa-major-agent:latest
```

To run:
```bash
touch botcfg.json
# Add botcfg
docker run -ti --network=host -v $(pwd):/mnt/ \
       -d --name ursa-major-agent --restart unless-stopped \
       ziminas1990/ursa-major-agent:latest
```