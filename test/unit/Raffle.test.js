const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              //   const { deployer } = await getNamedAccounts() // get deployer
              await deployments.fixture() // deploy all contracts
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffle = await ethers.getContract("Raffle", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", function () {
              it("initialises the raffle correctly", async function () {
                  // ideally 1 assert per "it"
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0") // checking state starts at open - "0"
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]) // checking interval is 30 seconds
              })
          })

          describe("enterRaffle", function () {
              it("reverts when you dont pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughEthEntered"
                  )
              })
              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("doesnt allow entrance when raffle is calculating", async function () {
                  // to get raffle into closed state, performUpkeep needs to be called. performUpkeep can only be called if checkUpkeep is true.
                  // otherwise it will revert with upkeepNotNeeded.
                  await raffle.enterRaffle({ value: raffleEntranceFee })

                  // below -> hardhat network reference docs
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) // increased time of blockchain

                  await network.provider.send("evm_mine", []) // mined block to go forward

                  // pretend to be a chainlink keeper to call performUpkeep
                  await raffle.performUpkeep([]) // passing empty calldata as param. + puts us in calculating state
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("returns false if people havent sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // since public function, calling this function will set off a transaction
                  // however we dont want to send a transaction, we want to simulate sending it and seeing if upkeepNeeded returns
                  // callstatic -> this will give return of upkeepNeeded and bytes memory performdata
                  // extrapolate upkeepNeeded as such
                  assert(!upkeepNeeded) // upkeepNeeded should return false, so !upkeepNeeded = true
                  // if upkeepNeeded returns true, !upkeepNeeded = false and the test will break.
              })

              it("returns false if raffle isnt open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.request({ method: "evm_mine", params: [] }) // different way of performing same operation as above
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  // can either pass "0x" or [empty array] as bytes memory
                  assert(!upkeepNeeded) // upkeepneeded returns false, !false = true
              })

              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkupkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  // made checkup return true from all the stuff above (conditions met)
                  assert(tx) // if tx doesnt work, this will fail, and this is how we know checkUpkeep returns true
              })

              it("reverts when checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })

              it("updates the raffle state and emits a requestId", async () => {
                  // Too many asserts in this test!
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await raffle.performUpkeep("0x") // emits requestId
                  const txReceipt = await txResponse.wait(1) // waits 1 block
                  const raffleState = await raffle.getRaffleState() // updates state
                  const requestId = txReceipt.events[1].args.requestId // requestRandomWords emits an event, so in performUpkeep, we want the event we created
                  assert(requestId.toNumber() > 0)
                  assert(raffleState == 1) // 0 = open, 1 = calculating
              })
          })

          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })

              it("can only be called after performupkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request") // these errors come from the VRFmock
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
              })

              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrances = 3 // additional players
                  const startingAccountIndex = 1 // since deployer is 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrances;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  }

                  const startingTimeStamp = await raffle.getLatestTimestamp()

                  // performUpkeep (mock being chainlink keepers)
                  // will kick off calling fulfillRandomWords (mock being the chainlink vrf)
                  // simulating waiting for fulfillRandomWords to be called by creating a listener (a new promise)

                  await new Promise(async function (resolve, reject) {
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event")
                          // once winnerPicked event emitted, do some stuff
                          // if event doesnt get emitted within 200 seconds, this test will result in failure
                          // try catch within the once so that if it takes too long, we throw an error, otherwise resolve
                          try {
                              //   console.log(accounts[0].address)
                              //   console.log(accounts[1].address)
                              //   console.log(accounts[2].address)
                              //   console.log(accounts[3].address)
                              const recentWinner = await raffle.getRecentWinner()
                              //   console.log(recentWinner)

                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLatestTimestamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp) // last time stamp shouldve been updated
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrances)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      // inside promise but outside listener we fire the event
                      const tx = await raffle.performUpkeep([]) // mocking chainlink keepers
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance() // run test first without this line to find winner (player 1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          // mocking chainlink vrf
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      ) // this should emit winnerpicked event, and then the listener should pick it up and run
                  })
              })
          })
      })
