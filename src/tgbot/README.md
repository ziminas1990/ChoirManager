## Update docker image

To update:
```bash
docker build --network=host -t ursa-major-agent .
docker tag ursa-major-agent ziminas1990/ursa-major-agent:latest
docker push ziminas1990/ursa-major-agent:latest
```

## Prepare the server (ubuntu 24.04)
If failed to login by copy-paste password, try this:
```bash
sshpass -p "..." ssh root@185.170.213.27
```

Run the following commands to install docker:
```bash
apt update
apt install -y ca-certificates curl gnupg
# Add GPG key:
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
# Add repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
# Install docker:
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```


## Run docker image on server

To run:
```bash
mkdir -p config
touch ./config/botcfg.json
touch ./config/runtime.json
touch ./config/users.json
touch ./config/google_cloud_key.json
touch ./config/tgbot_token
# Add botcfg
docker run -ti --network=host -v $(pwd)/config:/mnt/config \
       -d --name ursa-major-agent --restart unless-stopped \
       ziminas1990/ursa-major-agent:latest
```

For local run:
```bash
docker run -ti --network=host -v $(pwd)/config:/mnt/config --name ursa-major-agent ziminas1990/ursa-major-agent:latest
```