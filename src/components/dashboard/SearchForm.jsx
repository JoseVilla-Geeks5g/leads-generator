import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Switch,
  VStack,
  HStack,
  Text,
  useToast,
  Divider,
  Heading,
  Tabs, 
  TabList, 
  TabPanels,
  Tab, 
  TabPanel,
  Tag,
  Flex,
  IconButton,
  Tooltip
} from '@chakra-ui/react';
import { InfoOutlineIcon, CloseIcon } from '@chakra-ui/icons';
import { useRouter } from 'next/navigation';
import SearchableSelect from '../controls/SearchableSelect';
import RandomCategoriesForm from './RandomCategoriesForm';
import LocationInput from '../controls/LocationInput';

const SearchForm = () => {
  // Form state
  const [searchTerm, setSearchTerm] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState(5000);
  const [useRandomCategories, setUseRandomCategories] = useState(false);
  const [excludeCategories, setExcludeCategories] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const toast = useToast();
  const router = useRouter();

  // Load categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch('/api/categories');
        if (response.ok) {
          const data = await response.json();
          setAvailableCategories(data.categories || []);
        } else {
          console.error('Failed to fetch categories');
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };

    fetchCategories();
  }, []);

  // Form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const params = {
        searchTerm: useRandomCategories ? '' : searchTerm,
        location,
        limit,
        useRandomCategories,
        excludeCategories
      };

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      const data = await response.json();
      
      toast({
        title: 'Task created',
        description: `Task ID: ${data.taskId}`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      // Navigate to the task status page
      router.push(`/task/${data.taskId}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle exclude category selection
  const handleExcludeCategorySelect = (category) => {
    if (!excludeCategories.includes(category)) {
      setExcludeCategories([...excludeCategories, category]);
    }
  };

  // Remove an excluded category
  const removeExcludeCategory = (category) => {
    setExcludeCategories(excludeCategories.filter(cat => cat !== category));
  };

  return (
    <Box as="form" onSubmit={handleSubmit} width="100%">
      <Heading size="md" mb={4}>Search Google Maps Data</Heading>
      
      <Tabs variant="enclosed" index={activeTab} onChange={setActiveTab}>
        <TabList>
          <Tab>Specific Search</Tab>
          <Tab>Random Categories</Tab>
        </TabList>
        
        <TabPanels>
          {/* Specific Search Panel */}
          <TabPanel>
            <VStack spacing={4} align="flex-start">
              <FormControl isRequired={!useRandomCategories}>
                <FormLabel>Search Term</FormLabel>
                <Input 
                  placeholder="e.g., Digital Marketing Agency" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  isDisabled={useRandomCategories}
                />
              </FormControl>
            </VStack>
          </TabPanel>
          
          {/* Random Categories Panel */}
          <TabPanel>
            <VStack spacing={4} align="flex-start">
              <FormControl>
                <FormLabel>Use Random Categories Mode</FormLabel>
                <Switch 
                  isChecked={useRandomCategories} 
                  onChange={(e) => {
                    setUseRandomCategories(e.target.checked);
                    if (e.target.checked) {
                      setActiveTab(1);
                    } else {
                      setActiveTab(0);
                    }
                  }}
                  size="lg"
                  colorScheme="blue"
                />
              </FormControl>
              
              {useRandomCategories && (
                <>
                  <RandomCategoriesForm />
                  
                  <FormControl mt={4}>
                    <FormLabel>
                      <HStack>
                        <Text>Exclude Categories</Text>
                        <Tooltip label="Select categories you want to exclude from random selection">
                          <InfoOutlineIcon color="gray.500" />
                        </Tooltip>
                      </HStack>
                    </FormLabel>
                    <SearchableSelect
                      options={availableCategories.map(cat => ({ value: cat, label: cat }))}
                      placeholder="Select categories to exclude"
                      onChange={(selected) => handleExcludeCategorySelect(selected)}
                    />
                    
                    {excludeCategories.length > 0 && (
                      <Box mt={2}>
                        <Text fontSize="sm" mb={2}>Excluded categories:</Text>
                        <Flex wrap="wrap" gap={2}>
                          {excludeCategories.map(category => (
                            <Tag 
                              key={category} 
                              colorScheme="red" 
                              size="md"
                            >
                              {category}
                              <IconButton
                                icon={<CloseIcon />}
                                size="xs"
                                ml={1}
                                variant="ghost"
                                onClick={() => removeExcludeCategory(category)}
                                aria-label={`Remove ${category}`}
                              />
                            </Tag>
                          ))}
                        </Flex>
                      </Box>
                    )}
                  </FormControl>
                </>
              )}
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>
      
      <Divider my={4} />
      
      {/* Common fields for both modes */}
      <VStack spacing={4} align="flex-start" width="100%">
        <FormControl isRequired>
          <FormLabel>Location</FormLabel>
          <LocationInput 
            value={location}
            onChange={setLocation}
            placeholder="e.g., New York, NY"
          />
        </FormControl>
        
        <FormControl>
          <FormLabel>
            <HStack>
              <Text>Results Limit</Text>
              <Tooltip label="Maximum number of businesses to collect per search">
                <InfoOutlineIcon color="gray.500" />
              </Tooltip>
            </HStack>
          </FormLabel>
          <Input
            type="number"
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value))}
            min={100}
            max={10000}
          />
        </FormControl>
      </VStack>
      
      <Button
        mt={6}
        colorScheme="blue"
        isLoading={isLoading}
        type="submit"
        width="full"
      >
        Start Scraping
      </Button>
    </Box>
  );
};

export default SearchForm;
