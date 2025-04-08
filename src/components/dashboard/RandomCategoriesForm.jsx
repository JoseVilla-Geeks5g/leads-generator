import React from 'react';
import {
  FormControl,
  FormLabel,
  Text,
  Box,
  Tooltip,
  Icon,
  HStack,
  Alert,
  AlertIcon
} from '@chakra-ui/react';
import { InfoOutlineIcon } from '@chakra-ui/icons';

const RandomCategoriesForm = () => {
  return (
    <FormControl mt={4}>
      <FormLabel>
        <HStack>
          <Text>Random Categories Mode</Text>
          <Tooltip label="All available categories (after exclusions) will be used for comprehensive data collection">
            <Icon as={InfoOutlineIcon} color="gray.500" />
          </Tooltip>
        </HStack>
      </FormLabel>
      
      <Alert status="info" borderRadius="md">
        <AlertIcon />
        <Box>
          <Text fontWeight="medium">
            The system will automatically use all available categories
          </Text>
          <Text fontSize="sm" mt={1}>
            All categories in the database (except those you've excluded) will be used for scraping.
            This provides the most comprehensive data collection. You can exclude specific categories if needed.
          </Text>
        </Box>
      </Alert>
    </FormControl>
  );
};

export default RandomCategoriesForm;
