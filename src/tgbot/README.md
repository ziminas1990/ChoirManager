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
# Update local image (optional)
docker pull ziminas1990/ursa-major-agent:latest
# Run the bot
docker run -ti --network=host -v $(pwd)/config:/mnt/config \
       -d --name ursa-major-agent --restart unless-stopped \
       ziminas1990/ursa-major-agent:latest
```

For local run:
```bash
docker run -ti --rm --network=host -v $(pwd)/config:/mnt/config --name ursa-major-agent ziminas1990/ursa-major-agent:latest
```

## Things to be done:
* reload config with users by admin's request
* sending runtime.cfg backup to admin by request
* ignore all messages, received during the startup
* figure out how to enable valid markdown support in messages
* notifications about new applications
* notifications about new feedback
* use webpack to pack bot into a single js-file and publish docker image with this single file
* implement good logging