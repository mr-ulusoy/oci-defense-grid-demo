FROM fnproject/node:18-dev AS build
WORKDIR /function
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

FROM fnproject/node:18
WORKDIR /function
COPY --from=build /function /function
ENTRYPOINT ["node", "func.js"]
