'use strict'

const dynamoDbAlarms = require('../alarms-dynamodb')

const { test } = require('tap')
const { cloneDeep } = require('lodash')

const defaultConfig = require('../default-config')
const {
  assertCommonAlarmProperties,
  alarmNameToType,
  createTestConfig,
  createTestCloudFormationTemplate,
  defaultCfTemplate,
  testContext
} = require('./testing-utils')

const alarmConfig = createTestConfig(
  defaultConfig.alarms, {
    Period: 120,
    EvaluationPeriods: 2,
    TreatMissingData: 'breaching',
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    DynamoDB: {
      enabled: true,
      ReadThrottleEvents: {
        Threshold: 10
      },
      WriteThrottleEvents: {
        Threshold: 20
      },
      UserErrors: {
        Threshold: 100
      },
      SystemErrors: {
        Threshold: 200
      }
    }
  })

const dynamoDbAlarmConfig = alarmConfig.DynamoDB

;[true, false].forEach(specifyTableName => {
  test(`DynamoDB alarms are created ${specifyTableName ? 'with' : 'without'} a table name property`, (t) => {
    const { createDynamoDbAlarms } = dynamoDbAlarms(dynamoDbAlarmConfig, testContext)
    const cfTemplate = createTestCloudFormationTemplate()
    if (!specifyTableName) {
      for (const tableResource of Object.values(cfTemplate.getResourcesByType('AWS::DynamoDB::Table'))) {
        delete tableResource.Properties.TableName
      }
    }

    createDynamoDbAlarms(cfTemplate)

    const alarmResources = cfTemplate.getResourcesByType('AWS::CloudWatch::Alarm')

    const alarmsByType = {}
    t.equal(Object.keys(alarmResources).length, 6)
    for (const alarmResource of Object.values(alarmResources)) {
      const al = alarmResource.Properties
      assertCommonAlarmProperties(t, al)
      const alarmType = alarmNameToType(al.AlarmName)
      alarmsByType[alarmType] = alarmsByType[alarmType] || new Set()
      alarmsByType[alarmType].add(al)
    }

    const alarmCounts = {
      DDB_ReadThrottleEvents: 2,
      DDB_WriteThrottleEvents: 2,
      DDB_UserErrors: 1,
      DDB_SystemErrors: 1
    }

    t.same(new Set(Object.keys(alarmsByType)), new Set(Object.keys(alarmCounts)))

    for (const type of Object.keys(alarmCounts)) {
      t.equal(alarmsByType[type].size, alarmCounts[type])
      for (const al of alarmsByType[type]) {
        t.equal(al.Statistic, 'Sum')
        const metric = type.split('_')[1]
        t.equal(al.Threshold, dynamoDbAlarmConfig[metric].Threshold)
        t.equal(al.EvaluationPeriods, 2)
        t.equal(al.TreatMissingData, 'breaching')
        t.equal(al.ComparisonOperator, 'GreaterThanOrEqualToThreshold')
        t.equal(al.Namespace, 'AWS/DynamoDB')
        t.equal(al.Period, 120)
        t.equal(al.Dimensions[0].Name, 'TableName')
        t.ok(al.Dimensions[0].Value)
        if (al.Dimensions.length > 1) {
          t.same(al.Dimensions[1], {
            Name: 'GlobalSecondaryIndex',
            Value: 'GSI1'
          })
        }
      }
    }

    t.end()
  })
})

test('DynamoDB alarms are created without GSI', (t) => {
  const { createDynamoDbAlarms } = dynamoDbAlarms(dynamoDbAlarmConfig, testContext)
  const compiledTemplate = cloneDeep(defaultCfTemplate)
  delete compiledTemplate.Resources.dataTable.Properties.GlobalSecondaryIndexes
  const cfTemplate = createTestCloudFormationTemplate(compiledTemplate)
  createDynamoDbAlarms(cfTemplate)

  const alarmResources = cfTemplate.getResourcesByType('AWS::CloudWatch::Alarm')
  t.equal(Object.keys(alarmResources).length, 4)
  t.end()
})

test('DynamoDB alarms are not created when disabled', (t) => {
  const alarmConfig = createTestConfig(defaultConfig.alarms, {
    DynamoDB: {
      enabled: false
    }
  })

  const dynamoDbAlarmConfig = alarmConfig.DynamoDB
  const { createDynamoDbAlarms } = dynamoDbAlarms(dynamoDbAlarmConfig, testContext)
  const cfTemplate = createTestCloudFormationTemplate()
  createDynamoDbAlarms(cfTemplate)

  const alarmResources = cfTemplate.getResourcesByType('AWS::CloudWatch::Alarm')

  t.same({}, alarmResources)
  t.end()
})
